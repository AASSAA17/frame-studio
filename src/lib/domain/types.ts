import { z } from "zod";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export type Actor = { id: string; role: string };
export const quoteInputSchema = z.object({
  locationId: z.string().min(1).max(100),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(30).max(720),
  specialistId: z.string().min(1).max(100).optional(),
  serviceIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  equipmentIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  purpose: z.string().min(1).max(100).default("photo"),
  guests: z.number().int().min(1).max(100).default(1),
});
export const bookingInputSchema = quoteInputSchema.extend({
  name: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(6).max(40),
  comment: z.string().trim().max(2000).default(""),
  acceptRules: z.literal(true),
});
export type QuoteInput = z.input<typeof quoteInputSchema>;
export type BookingInput = z.input<typeof bookingInputSchema>;
export type QuoteItem = {
  label: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
};
export type AvailabilityInput = {
  locationId: string;
  date: string;
  durationMinutes: number;
  specialistId?: string;
  equipmentIds?: string[];
};
export function invariant(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export const isStaff = (actor: Actor) =>
  actor.role === "OWNER" || actor.role === "ADMIN";
