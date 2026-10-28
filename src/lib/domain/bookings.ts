import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { lockStudio, lockCreationKey } from "./locks";
import { Prisma, type BookingStatus } from "@prisma/client";
import { db } from "../db";
import { prepareQuote, type DbClient, type ResourceNeed } from "./catalog";
import {
  availableUnits,
  lockResources,
  reserveResources,
} from "./availability";
import { paymentSummary } from "./pricing";
import {
  bookingInputSchema,
  quoteInputSchema,
  invariant,
  isStaff,
  type Actor,
  type BookingInput,
} from "./types";

export const bookingInclude = Prisma.validator<Prisma.BookingInclude>()({
  items: true,
  payments: { orderBy: { createdAt: "asc" } },
  specialist: true,
});
export type BookingRecord = Prisma.BookingGetPayload<{
  include: typeof bookingInclude;
}>;
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function effectiveStatus(
  booking: { status: BookingStatus; expiresAt: Date | null },
  now = new Date(),
): BookingStatus {
  return booking.status === "awaiting_payment" &&
    booking.expiresAt &&
    booking.expiresAt <= now
    ? "expired"
    : booking.status;
}

export function bookingDto(booking: BookingRecord) {
  return {
    id: booking.id,
    number: booking.number,
    userId: booking.userId,
    name: booking.name,
    phone: booking.phone,
    purpose: booking.purpose,
    guests: booking.guests,
    locationId: booking.locationId,
    locationName: booking.locationName,
    versionName: booking.versionName,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    status: effectiveStatus(booking),
    expiresAt: booking.expiresAt?.toISOString() ?? null,
    currency: booking.currency,
    totalMinor: booking.totalMinor,
    depositMinor: booking.depositMinor,
    ...paymentSummary(booking.payments, booking.totalMinor),
    items: booking.items.map(
      ({ label, quantity, unitPriceMinor, totalMinor }) => ({
        label,
        quantity,
        unitPriceMinor,
        totalMinor,
      }),
    ),
    comment: booking.comment,
    specialistId: booking.specialistId,
    specialistName: booking.specialistName,
    rulesText: booking.rulesText,
    rulesVersion: booking.rulesVersion,
    createdAt: booking.createdAt.toISOString(),
    payments: booking.payments.map(
      ({ id, kind, amountMinor, currency, method, createdAt }) => ({
        id,
        kind,
        amountMinor,
        currency,
        method,
        createdAt: createdAt.toISOString(),
      }),
    ),
  };
}

export function authorizeBooking(
  booking: BookingRecord,
  actor: Actor,
  staffOnly = false,
) {
  const allowed =
    isStaff(actor) ||
    (!staffOnly &&
      (booking.userId === actor.id ||
        (actor.role === "SPECIALIST" &&
          booking.specialist?.userId === actor.id)));
  invariant(allowed, "NOT_FOUND", "Бронирование не найдено.", 404);
}

function visibleBooking(booking: BookingRecord, actor: Actor) {
  const dto = bookingDto(booking);
  if (isStaff(actor))
    return {
      ...dto,
      customerId: booking.customerId,
      createdById: booking.createdById,
      source: booking.source,
      payments: dto.payments.map((payment, index) => ({
        ...payment,
        actorId: booking.payments[index].actorId,
        comment: booking.payments[index].comment,
      })),
    };
  if (actor.role !== "SPECIALIST") return dto;
  // Assigned specialists receive the shooting brief, not the client's account or payment ledger.
  return {
    id: dto.id,
    number: dto.number,
    name: dto.name,
    purpose: dto.purpose,
    guests: dto.guests,
    locationId: dto.locationId,
    locationName: dto.locationName,
    versionName: dto.versionName,
    startAt: dto.startAt,
    endAt: dto.endAt,
    status: dto.status,
    comment: dto.comment,
    specialistId: dto.specialistId,
    specialistName: dto.specialistName,
  };
}

export async function lockBooking(client: DbClient, id: string) {
  await client.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`,
  );
  const booking = await client.booking.findUnique({
    where: { id },
    include: bookingInclude,
  });
  invariant(booking, "NOT_FOUND", "Бронирование не найдено.", 404);
  return booking;
}

export async function audit(
  client: DbClient,
  actorId: string,
  action: string,
  entityId: string,
  metadata: unknown = {},
) {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType: "Booking",
      entityId,
      metadata: json(metadata),
    },
  });
}

export async function notifyBooking(
  client: DbClient,
  booking: {
    id: string;
    userId: string | null;
    number: string;
    startAt: Date;
    status: BookingStatus;
  },
  reason: string,
) {
  if (!booking.userId) return;
  const user = await client.user.findUnique({
    where: { id: booking.userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.emailVerified) return;
  const title =
    reason === "created"
      ? "Бронирование создано"
      : reason === "canceled"
        ? "Бронирование отменено"
        : reason === "rescheduled"
          ? "Время бронирования изменено"
          : "Платёж зарегистрирован";
  await client.notificationJob.create({
    data: {
      bookingId: booking.id,
      dedupeKey: `${booking.id}:${reason}:${randomBytes(8).toString("hex")}`,
      to: user.email,
      subject: `${title} · ${booking.number}`,
      text: `${title}: ${booking.number}. Подробности и актуальное состояние — в личном кабинете FRAME STUDIO. Это уведомление демонстрационной системы.`,
    },
  });
}

export async function scheduleReminders(
  client: DbClient,
  booking: { id: string; userId: string | null; number: string; startAt: Date },
) {
  if (!booking.userId) return;
  const user = await client.user.findUnique({
    where: { id: booking.userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.emailVerified) return;
  await client.notificationJob.updateMany({
    where: {
      bookingId: booking.id,
      status: "pending",
      dedupeKey: { startsWith: `${booking.id}:reminder:` },
    },
    data: { status: "canceled" },
  });
  const settings = await client.studioSettings.findUniqueOrThrow({
    where: { id: "studio" },
  });
  for (const hours of [...new Set(settings.reminderHours)].filter(
    (value) => value > 0 && value <= 720,
  )) {
    const scheduledAt = new Date(booking.startAt.getTime() - hours * 3_600_000);
    if (scheduledAt <= new Date()) continue;
    const dedupeKey = `${booking.id}:reminder:${booking.startAt.toISOString()}:${hours}`;
    await client.notificationJob.updateMany({
      where: { dedupeKey, status: "canceled" },
      data: {
        status: "pending",
        scheduledAt,
        attempts: 0,
        lockedUntil: null,
        lastError: null,
      },
    });
    await client.notificationJob.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        bookingId: booking.id,
        dedupeKey: `${booking.id}:reminder:${booking.startAt.toISOString()}:${hours}`,
        to: user.email,
        subject: `Съёмка через ${hours} ч. · ${booking.number}`,
        text: `Напоминание о бронировании ${booking.number}. Время и детали доступны в личном кабинете.`,
        scheduledAt,
      },
    });
  }
}

export async function getBooking(id: string, actor: Actor) {
  const booking = await db.booking.findUnique({
    where: { id },
    include: bookingInclude,
  });
  invariant(booking, "NOT_FOUND", "Бронирование не найдено.", 404);
  authorizeBooking(booking, actor);
  return visibleBooking(booking, actor);
}

export async function listBookings(actor: Actor) {
  const where: Prisma.BookingWhereInput = isStaff(actor)
    ? {}
    : actor.role === "SPECIALIST"
      ? { specialist: { userId: actor.id } }
      : { userId: actor.id };
  const bookings = await db.booking.findMany({
    where,
    include: bookingInclude,
    orderBy: { startAt: "desc" },
    take: 200,
  });
  return bookings.map((booking) => visibleBooking(booking, actor));
}

const manualBookingSchema = quoteInputSchema
  .extend({
    customerId: z.string().min(1).max(100),
    source: z.enum(["phone", "message", "walk_in", "other"]),
    idempotencyKey: z.string().min(8).max(150),
    expectedTotalMinor: z.number().int().nonnegative().optional(),
    expectedQuoteFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    comment: z.string().trim().max(2000).default(""),
    acceptRules: z.literal(true),
  })
  .strict();

function creationHash(input: Record<string, unknown>) {
  const { idempotencyKey: _key, ...canonical } = input;
  if (Array.isArray(canonical.serviceIds))
    canonical.serviceIds = [...new Set(canonical.serviceIds)].sort();
  if (Array.isArray(canonical.equipmentIds))
    canonical.equipmentIds = [...canonical.equipmentIds].sort();
  if (typeof canonical.startAt === "string")
    canonical.startAt = new Date(canonical.startAt).toISOString();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
async function existingCreation(
  client: DbClient,
  key: string | null,
  hash: string,
  actor: Actor,
) {
  if (!key) return null;
  await lockCreationKey(client, key);
  const previous = await client.booking.findUnique({
    where: { creationKey: key },
    include: bookingInclude,
  });
  if (!previous) return null;
  invariant(
    previous.creationPayloadHash === hash,
    "IDEMPOTENCY_CONFLICT",
    "Этот ключ создания уже использован с другими данными.",
    409,
  );
  authorizeBooking(previous, actor);
  return visibleBooking(previous, actor);
}

export async function createBooking(raw: BookingInput, userId: string) {
  const input = bookingInputSchema.parse(raw);
  const key = input.idempotencyKey
    ? `website:${userId}:${input.idempotencyKey}`
    : null;
  const hash = creationHash(input);
  return db.$transaction(
    async (client) => {
      await lockStudio(client);
      const actor = { id: userId, role: "CLIENT" };
      const user = await client.user.findUnique({ where: { id: userId } });
      invariant(
        user?.emailVerified,
        "VERIFY_EMAIL",
        "Подтвердите электронную почту перед бронированием.",
        403,
      );
      const previous = await existingCreation(client, key, hash, actor);
      if (previous) return previous as ReturnType<typeof bookingDto>;
      // Identity is established by verified userId, never by matching phone/email text.
      const customer = await client.customer.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          name: input.name,
          email: user.email,
          phone: input.phone,
          normalizedPhone: input.phone.replace(/\D/g, ""),
        },
      });
      invariant(
        !customer.archivedAt,
        "CUSTOMER_ARCHIVED",
        "Профиль клиента архивирован. Обратитесь в студию.",
        409,
      );
      return createBookingInTransaction(client, input, {
        customerId: customer.id,
        userId,
        actor,
        source: "website",
        key,
        hash,
      });
    },
    { maxWait: 20_000, timeout: 30_000 },
  );
}

export async function createManualBooking(raw: unknown, actor: Actor) {
  invariant(
    isStaff(actor),
    "FORBIDDEN",
    "Ручную запись создаёт сотрудник студии.",
    403,
  );
  const input = manualBookingSchema.parse(raw);
  const key = `manual:${actor.id}:${input.idempotencyKey}`;
  const hash = creationHash(input);
  return db.$transaction(
    async (client) => {
      await lockStudio(client);
      const previous = await existingCreation(client, key, hash, actor);
      if (previous) return previous;
      const customer = await client.customer.findUnique({
        where: { id: input.customerId },
        include: { user: true },
      });
      invariant(
        customer && !customer.archivedAt,
        "CUSTOMER_UNAVAILABLE",
        "Выберите действующего клиента.",
        404,
      );
      const userId = customer.user?.emailVerified ? customer.userId : null;
      return createBookingInTransaction(
        client,
        { ...input, name: customer.name, phone: customer.phone ?? "" },
        {
          customerId: customer.id,
          userId,
          actor,
          source: input.source,
          key,
          hash,
        },
      );
    },
    { maxWait: 20_000, timeout: 30_000 },
  );
}

async function createBookingInTransaction(
  client: DbClient,
  input: z.output<typeof quoteInputSchema> & {
    name: string;
    phone: string;
    comment: string;
    acceptRules: true;
    expectedTotalMinor?: number;
    expectedQuoteFingerprint?: string;
  },
  identity: {
    customerId: string;
    userId: string | null;
    actor: Actor;
    source: string;
    key: string | null;
    hash: string;
  },
) {
  const prepared = await prepareQuote(input, client);
  invariant(
    input.expectedQuoteFingerprint === undefined ||
      input.expectedQuoteFingerprint === prepared.quote.fingerprint,
    "QUOTE_CHANGED",
    "Цена, предоплата, правила или оформление изменились. Обновите расчёт и подтвердите актуальные условия.",
    409,
  );
  invariant(
    input.expectedTotalMinor === undefined ||
      input.expectedTotalMinor === prepared.quote.totalMinor,
    "PRICE_CHANGED",
    "Стоимость изменилась. Обновите расчёт и подтвердите новую сумму.",
    409,
  );
  await lockResources(
    client,
    prepared.needs.map((need) => need.resourceId),
  );
  await availableUnits(client, prepared.needs, prepared.settings.timezone);
  const expiresAt = new Date(
    Date.now() + prepared.settings.holdMinutes * 60_000,
  );
  const booking = await client.booking.create({
    data: {
      number: `FS-${randomBytes(5).toString("hex").toUpperCase()}`,
      userId: identity.userId,
      customerId: identity.customerId,
      createdById: identity.actor.id,
      source: identity.source,
      creationKey: identity.key,
      creationPayloadHash: identity.hash,
      locationId: prepared.location.id,
      decorVersionId: prepared.version.id,
      specialistId: prepared.specialist?.id,
      name: input.name,
      phone: input.phone,
      purpose: input.purpose,
      guests: input.guests,
      comment: input.comment,
      startAt: prepared.startAt,
      endAt: prepared.endAt,
      expiresAt,
      currency: prepared.quote.currency,
      totalMinor: prepared.quote.totalMinor,
      depositMinor: prepared.quote.depositMinor,
      locationName: prepared.location.name,
      versionName: prepared.version.name,
      specialistName: prepared.specialist?.name,
      rulesVersion: prepared.settings.rulesVersion,
      rulesText: prepared.settings.rulesText,
      inputSnapshot: json({
        ...input,
        resourceNeeds: prepared.needs,
        timezone: prepared.settings.timezone,
      }),
      versionSnapshot: json({
        id: prepared.version.id,
        name: prepared.version.name,
        image: prepared.version.image,
      }),
      items: { create: prepared.quote.items },
      ...(prepared.specialist ||
      prepared.services.some((service) => service.production)
        ? {
            contentProject: {
              create: { title: `${input.purpose} · ${prepared.location.name}` },
            },
          }
        : {}),
    },
    include: bookingInclude,
  });
  await reserveResources(
    client,
    prepared.needs,
    prepared.settings.timezone,
    booking.id,
    expiresAt,
  );
  if (identity.userId)
    await client.consent.create({
      data: {
        userId: identity.userId,
        kind: "booking_rules",
        version: prepared.settings.rulesVersion,
      },
    });
  await audit(
    client,
    identity.actor.id,
    identity.source === "website"
      ? "booking.created"
      : "booking.manual_created",
    booking.id,
    {
      before: null,
      after: bookingDto(booking),
      customerId: identity.customerId,
      source: identity.source,
      rulesAcceptanceRecordedBy: identity.actor.id,
    },
  );
  await notifyBooking(client, booking, "created");
  const dto = bookingDto(booking);
  return isStaff(identity.actor)
    ? {
        ...dto,
        customerId: booking.customerId,
        createdById: booking.createdById,
        source: booking.source,
      }
    : dto;
}
export function savedResources(booking: BookingRecord): {
  needs: ResourceNeed[];
  timezone: string;
} {
  const snapshot = booking.inputSnapshot as unknown as {
    resourceNeeds: {
      resourceId: string;
      count: number;
      startAt: string;
      endAt: string;
    }[];
    timezone: string;
  };
  return {
    needs: snapshot.resourceNeeds.map((need) => ({
      ...need,
      startAt: new Date(need.startAt),
      endAt: new Date(need.endAt),
    })),
    timezone: snapshot.timezone,
  };
}

export async function cancelBooking(id: string, actor: Actor) {
  return db.$transaction(async (client) => {
    await lockStudio(client);
    const booking = await lockBooking(client, id);
    authorizeBooking(booking, actor);
    invariant(
      isStaff(actor) || booking.userId === actor.id,
      "FORBIDDEN",
      "Отмена доступна клиенту и администратору.",
      403,
    );
    invariant(
      ["awaiting_payment", "confirmed", "expired"].includes(
        effectiveStatus(booking),
      ),
      "INVALID_STATUS",
      "Эту запись нельзя отменить.",
      409,
    );
    invariant(
      isStaff(actor) || booking.startAt > new Date(),
      "TOO_LATE",
      "Для отмены начавшейся съёмки обратитесь в студию.",
      409,
    );
    const saved = savedResources(booking);
    await lockResources(
      client,
      saved.needs.map((need) => need.resourceId),
    );
    await client.allocation.updateMany({
      where: { bookingId: id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    const updated = await client.booking.update({
      where: { id },
      data: { status: "canceled", expiresAt: null },
      include: bookingInclude,
    });
    await client.notificationJob.updateMany({
      where: { bookingId: id, status: "pending" },
      data: { status: "canceled" },
    });
    if (paymentSummary(booking.payments, booking.totalMinor).paidMinor > 0)
      await client.task.create({
        data: {
          bookingId: id,
          kind: "refund_review",
          title: "Проверить возврат по отменённому заказу",
        },
      });
    await audit(client, actor.id, "booking.canceled", id);
    await notifyBooking(client, updated, "canceled");
    return bookingDto(updated);
  });
}

export async function rescheduleBooking(
  id: string,
  input: { startAt: string; durationMinutes: number },
  actor: Actor,
) {
  return db.$transaction(
    async (client) => {
      await lockStudio(client);
      const booking = await lockBooking(client, id);
      authorizeBooking(booking, actor);
      invariant(
        isStaff(actor) || booking.userId === actor.id,
        "FORBIDDEN",
        "Перенос доступен клиенту и администратору.",
        403,
      );
      invariant(
        ["confirmed", "awaiting_payment"].includes(effectiveStatus(booking)),
        "INVALID_STATUS",
        "Перенос этой записи недоступен.",
        409,
      );
      const priorInput = booking.inputSnapshot as unknown as BookingInput;
      const prepared = await prepareQuote({ ...priorInput, ...input }, client);
      const saved = savedResources(booking);
      await lockResources(
        client,
        [...saved.needs, ...prepared.needs].map((need) => need.resourceId),
      );
      await availableUnits(
        client,
        prepared.needs,
        prepared.settings.timezone,
        new Date(),
        id,
      );
      const paid = paymentSummary(
        booking.payments,
        booking.totalMinor,
      ).paidMinor;
      invariant(
        paid <= prepared.quote.totalMinor,
        "REFUND_REQUIRED",
        "Сначала согласуйте возврат разницы с администратором.",
        409,
      );
      invariant(
        booking.status !== "confirmed" || paid >= prepared.quote.depositMinor,
        "EXTRA_DEPOSIT_REQUIRED",
        "Для переноса сначала внесите необходимую доплату.",
        409,
      );
      // Releasing original allocations and acquiring new ones occur in one transaction; errors roll everything back.
      await client.allocation.updateMany({
        where: { bookingId: id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      const expiresAt =
        booking.status === "awaiting_payment" ? booking.expiresAt : null;
      await reserveResources(
        client,
        prepared.needs,
        prepared.settings.timezone,
        id,
        expiresAt,
      );
      await client.bookingItem.deleteMany({ where: { bookingId: id } });
      const updated = await client.booking.update({
        where: { id },
        data: {
          startAt: prepared.startAt,
          endAt: prepared.endAt,
          decorVersionId: prepared.version.id,
          versionName: prepared.version.name,
          totalMinor: prepared.quote.totalMinor,
          depositMinor: prepared.quote.depositMinor,
          inputSnapshot: json({
            ...priorInput,
            ...input,
            resourceNeeds: prepared.needs,
            timezone: prepared.settings.timezone,
          }),
          versionSnapshot: json({
            id: prepared.version.id,
            name: prepared.version.name,
            image: prepared.version.image,
          }),
          items: { create: prepared.quote.items },
        },
        include: bookingInclude,
      });
      await client.bookingRevision.create({
        data: {
          bookingId: id,
          actorId: actor.id,
          before: json(bookingDto(booking)),
          after: json(bookingDto(updated)),
        },
      });
      await audit(client, actor.id, "booking.rescheduled", id, {
        from: booking.startAt,
        to: updated.startAt,
      });
      await client.notificationJob.updateMany({
        where: { bookingId: id, status: "pending" },
        data: { status: "canceled" },
      });
      await notifyBooking(client, updated, "rescheduled");
      if (updated.status === "confirmed")
        await scheduleReminders(client, updated);
      return bookingDto(updated);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export async function changeBookingStatus(
  id: string,
  status: BookingStatus,
  actor: Actor,
) {
  invariant(isStaff(actor), "FORBIDDEN", "Недостаточно прав.", 403);
  const transitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
    confirmed: ["in_progress", "no_show"],
    in_progress: ["completed"],
  };
  return db.$transaction(async (client) => {
    await lockStudio(client);
    const booking = await lockBooking(client, id);
    invariant(
      transitions[effectiveStatus(booking)]?.includes(status),
      "INVALID_TRANSITION",
      "Недопустимый переход статуса. Подтверждение выполняется после регистрации предоплаты.",
      409,
    );
    if (status === "completed")
      invariant(
        paymentSummary(booking.payments, booking.totalMinor).balanceMinor === 0,
        "PAYMENT_REQUIRED",
        "Перед завершением зарегистрируйте оплату остатка.",
        409,
      );
    const updated = await client.booking.update({
      where: { id },
      data: { status },
      include: bookingInclude,
    });
    await audit(client, actor.id, `booking.${status}`, id);
    return bookingDto(updated);
  });
}

export async function expireHolds() {
  const candidates = await db.booking.findMany({
    where: { status: "awaiting_payment", expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
  let expired = 0;
  for (const candidate of candidates) {
    const changed = await db.$transaction(async (client) => {
      await lockStudio(client);
      const booking = await lockBooking(client, candidate.id);
      if (
        effectiveStatus(booking) !== "expired" ||
        booking.status !== "awaiting_payment"
      )
        return false;
      const saved = savedResources(booking);
      await lockResources(
        client,
        saved.needs.map((need) => need.resourceId),
      );
      await client.allocation.updateMany({
        where: { bookingId: booking.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      await client.booking.update({
        where: { id: booking.id },
        data: { status: "expired" },
      });
      await client.notificationJob.updateMany({
        where: { bookingId: booking.id, status: "pending" },
        data: { status: "canceled" },
      });
      if (paymentSummary(booking.payments, booking.totalMinor).paidMinor > 0)
        await client.task.create({
          data: {
            bookingId: booking.id,
            kind: "refund_review",
            title: "Удержание истекло: проверить частичную оплату",
          },
        });
      await audit(client, "system", "booking.expired", booking.id);
      return true;
    });
    if (changed) expired++;
  }
  return { expired };
}
