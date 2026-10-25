import { z } from "zod";
import { db } from "../db";
import type { DbClient } from "./catalog";
import {
  lockResources,
  availableUnits,
  reserveResources,
} from "./availability";
import {
  audit,
  authorizeBooking,
  bookingDto,
  bookingInclude,
  effectiveStatus,
  lockBooking,
  notifyBooking,
  savedResources,
  scheduleReminders,
  type BookingRecord,
} from "./bookings";
import { paymentSummary } from "./pricing";
import { DomainError, invariant, isStaff, type Actor } from "./types";

const paymentInputSchema = z.object({
  amountMinor: z.number().int().positive().max(2_000_000_000),
  method: z.enum(["TEST", "MANUAL"]),
  idempotencyKey: z.string().min(8).max(150),
  comment: z.string().trim().max(1000).default(""),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export async function recordPayment(
  id: string,
  raw: PaymentInput,
  actor: Actor,
) {
  const input = paymentInputSchema.parse(raw);
  invariant(
    input.method !== "TEST" || process.env.PAYMENT_MODE === "test",
    "TEST_DISABLED",
    "Тестовая оплата отключена.",
    403,
  );
  invariant(
    input.method !== "MANUAL" || isStaff(actor),
    "FORBIDDEN",
    "Ручную оплату подтверждает сотрудник студии.",
    403,
  );
  return db.$transaction(
    async (client) => {
      const booking = await lockBooking(client, id);
      return recordPaymentLocked(client, booking, input, actor);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

async function recordPaymentLocked(
  client: DbClient,
  booking: BookingRecord,
  input: z.output<typeof paymentInputSchema>,
  actor: Actor,
) {
  const id = booking.id;
  authorizeBooking(booking, actor);
  invariant(
    isStaff(actor) || booking.userId === actor.id,
    "FORBIDDEN",
    "Недостаточно прав для оплаты.",
    403,
  );
  const previous = await client.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (previous) {
    invariant(
      previous.bookingId === id &&
        previous.kind === "CHARGE" &&
        previous.amountMinor === input.amountMinor &&
        previous.method === input.method,
      "IDEMPOTENCY_CONFLICT",
      "Этот ключ уже использован для другой операции.",
      409,
    );
    return {
      ...bookingDto(booking),
      needsReview:
        (await client.task.count({
          where: { bookingId: id, kind: "late_payment", status: "open" },
        })) > 0,
    };
  }
  invariant(
    !["canceled", "completed", "no_show"].includes(booking.status),
    "INVALID_STATUS",
    "Оплата для этого статуса недоступна.",
    409,
  );
  const payment = paymentSummary(booking.payments, booking.totalMinor);
  invariant(
    input.amountMinor <= payment.balanceMinor,
    "OVERPAYMENT",
    "Сумма больше неоплаченного остатка.",
    409,
  );
  const saved = savedResources(booking);
  await lockResources(
    client,
    saved.needs.map((need) => need.resourceId),
  );
  let needsReview = false;
  const expired = effectiveStatus(booking) === "expired";
  if (expired) {
    try {
      invariant(
        booking.startAt > new Date(),
        "PAST_TIME",
        "Время съёмки уже прошло.",
        409,
      );
      await availableUnits(client, saved.needs, saved.timezone, new Date(), id);
    } catch (error) {
      if (!(error instanceof DomainError) || error.status !== 409) throw error;
      needsReview = true;
    }
  }
  await client.payment.create({
    data: {
      bookingId: id,
      kind: "CHARGE",
      amountMinor: input.amountMinor,
      currency: booking.currency,
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      actorId: actor.id,
      comment: input.comment,
    },
  });
  let status = booking.status;
  let expiresAt = booking.expiresAt;
  if (needsReview) {
    status = "expired";
    await client.task.create({
      data: {
        bookingId: id,
        kind: "late_payment",
        title: "Поздний платёж: согласовать альтернативу или оформить возврат",
      },
    });
    await client.allocation.updateMany({
      where: { bookingId: id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  } else {
    const netPaid = payment.paidMinor + input.amountMinor;
    if (netPaid >= booking.depositMinor) {
      if (booking.status === "awaiting_payment" || booking.status === "expired")
        status = "confirmed";
      expiresAt = null;
    } else if (expired) {
      const settings = await client.studioSettings.findUniqueOrThrow({
        where: { id: "studio" },
      });
      status = "awaiting_payment";
      expiresAt = new Date(Date.now() + settings.holdMinutes * 60_000);
    }
    if (expired) {
      await client.allocation.updateMany({
        where: { bookingId: id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      await reserveResources(
        client,
        saved.needs,
        saved.timezone,
        id,
        expiresAt,
      );
    } else {
      await client.allocation.updateMany({
        where: { bookingId: id, releasedAt: null },
        data: { expiresAt },
      });
    }
  }
  const updated = await client.booking.update({
    where: { id },
    data: { status, expiresAt },
    include: bookingInclude,
  });
  await audit(client, actor.id, "payment.recorded", id, {
    amountMinor: input.amountMinor,
    method: input.method,
    needsReview,
  });
  await notifyBooking(client, updated, "payment");
  if (updated.status === "confirmed" && booking.status !== "confirmed")
    await scheduleReminders(client, updated);
  return { ...bookingDto(updated), needsReview };
}

/** The public test adapter fixes an intent amount under the same lock as its ledger write. */
export async function recordTestPayment(
  id: string,
  raw: { idempotencyKey: string; target?: "deposit" | "balance" },
  actor: Actor,
) {
  invariant(
    process.env.PAYMENT_MODE === "test",
    "TEST_DISABLED",
    "Тестовая оплата отключена.",
    403,
  );
  const input = z
    .object({
      idempotencyKey: z.string().min(8).max(150),
      target: z.enum(["deposit", "balance"]).default("deposit"),
    })
    .parse(raw);
  const comment =
    input.target === "deposit"
      ? "Тестовая предоплата. Реальные деньги не списываются."
      : "Тестовая оплата остатка. Реальные деньги не списываются.";
  return db.$transaction(
    async (client) => {
      const booking = await lockBooking(client, id);
      authorizeBooking(booking, actor);
      invariant(
        isStaff(actor) || booking.userId === actor.id,
        "FORBIDDEN",
        "Недостаточно прав для оплаты.",
        403,
      );
      const previous = await client.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (previous) {
        invariant(
          previous.bookingId === id &&
            previous.kind === "CHARGE" &&
            previous.method === "TEST" &&
            previous.comment === comment,
          "IDEMPOTENCY_CONFLICT",
          "Этот ключ уже использован для другой операции.",
          409,
        );
        return {
          ...bookingDto(booking),
          needsReview:
            (await client.task.count({
              where: { bookingId: id, kind: "late_payment", status: "open" },
            })) > 0,
        };
      }
      const summary = paymentSummary(booking.payments, booking.totalMinor);
      const amountMinor =
        input.target === "deposit"
          ? Math.max(0, booking.depositMinor - summary.paidMinor)
          : summary.balanceMinor;
      invariant(
        amountMinor > 0,
        "ALREADY_PAID",
        input.target === "deposit"
          ? "Предоплата уже внесена."
          : "Заказ уже оплачен.",
        409,
      );
      return recordPaymentLocked(
        client,
        booking,
        {
          amountMinor,
          method: "TEST",
          idempotencyKey: input.idempotencyKey,
          comment,
        },
        actor,
      );
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export async function refundPayment(
  id: string,
  raw: { amountMinor: number; idempotencyKey: string; comment: string },
  actor: Actor,
) {
  invariant(
    isStaff(actor),
    "FORBIDDEN",
    "Возврат подтверждает сотрудник студии.",
    403,
  );
  const input = paymentInputSchema
    .omit({ method: true })
    .extend({ comment: z.string().trim().min(3).max(1000) })
    .parse(raw);
  return db.$transaction(async (client) => {
    const booking = await lockBooking(client, id);
    const previous = await client.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (previous) {
      invariant(
        previous.bookingId === id &&
          previous.kind === "REFUND" &&
          previous.amountMinor === input.amountMinor,
        "IDEMPOTENCY_CONFLICT",
        "Этот ключ уже использован для другой операции.",
        409,
      );
      return bookingDto(booking);
    }
    invariant(
      input.amountMinor <=
        paymentSummary(booking.payments, booking.totalMinor).paidMinor,
      "EXCESS_REFUND",
      "Возврат не может превышать полученную сумму.",
      409,
    );
    await client.payment.create({
      data: {
        bookingId: id,
        kind: "REFUND",
        amountMinor: input.amountMinor,
        currency: booking.currency,
        method: "MANUAL",
        actorId: actor.id,
        idempotencyKey: input.idempotencyKey,
        comment: input.comment,
      },
    });
    await audit(client, actor.id, "payment.refunded", id, {
      amountMinor: input.amountMinor,
    });
    const updated = await client.booking.findUniqueOrThrow({
      where: { id },
      include: bookingInclude,
    });
    if (paymentSummary(updated.payments, updated.totalMinor).paidMinor === 0)
      await client.task.updateMany({
        where: {
          bookingId: id,
          kind: { in: ["late_payment", "refund_review"] },
          status: "open",
        },
        data: { status: "done" },
      });
    return bookingDto(updated);
  });
}
