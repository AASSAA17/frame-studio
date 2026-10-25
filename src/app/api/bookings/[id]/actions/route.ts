import { z } from "zod";
import {
  recordTestPayment,
  recordPayment,
  cancelBooking,
  rescheduleBooking,
  changeBookingStatus,
  refundPayment,
} from "@/lib/domain";
import { DomainError } from "@/lib/domain/types";
import {
  actorFor,
  assertSameOrigin,
  handle,
  readJson,
  requireStaff,
  rateLimit,
} from "@/lib/http";
const key = z.string().min(8).max(150);
const amount = z.number().int().positive().max(1_000_000_000);
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("test-payment"),
    idempotencyKey: key,
    target: z.enum(["deposit", "balance"]).default("deposit"),
  }),
  z.object({
    action: z.literal("manual-payment"),
    amountMinor: amount,
    method: z.string().trim().min(1).max(80),
    comment: z.string().trim().min(1).max(900),
    idempotencyKey: key,
  }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("status"),
    status: z.enum(["confirmed", "in_progress", "completed", "no_show"]),
  }),
  z.object({
    action: z.literal("reschedule"),
    startAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(30).max(720),
  }),
  z.object({
    action: z.literal("refund"),
    amountMinor: amount,
    comment: z.string().trim().min(3).max(900),
    idempotencyKey: key,
  }),
]);
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    await rateLimit(`action:${actor.id}`, 30);
    const { id } = await context.params;
    const body = schema.parse(await readJson(request));
    if (body.action === "test-payment") {
      if (process.env.PAYMENT_MODE !== "test")
        throw new DomainError(
          "TEST_DISABLED",
          "Тестовая оплата отключена.",
          403,
        );
      // Derive the remaining amount and resolve retries inside the booking transaction.
      return recordTestPayment(
        id,
        { idempotencyKey: body.idempotencyKey, target: body.target },
        actor,
      );
    }
    if (body.action === "cancel") return cancelBooking(id, actor);
    requireStaff(actor);
    if (body.action === "manual-payment")
      return recordPayment(
        id,
        {
          amountMinor: body.amountMinor,
          method: "MANUAL",
          idempotencyKey: body.idempotencyKey,
          comment: `${body.method}: ${body.comment}`,
        },
        actor,
      );
    if (body.action === "refund") return refundPayment(id, body, actor);
    if (body.action === "reschedule") return rescheduleBooking(id, body, actor);
    return changeBookingStatus(id, body.status, actor);
  });
}
