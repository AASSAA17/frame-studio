import { z } from "zod";
import { IANAZone } from "luxon";

const text = (max = 150) => z.string().trim().min(1).max(max);
const amount = z.number().int().nonnegative().max(1_000_000_000);
const hour = z.number().int().min(0).max(23);
const closeHour = z.number().int().min(0).max(24);
const urlOrBlank = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => !value || /^https:\/\//i.test(value),
    "Используйте адрес https:// или оставьте поле пустым.",
  );
const image = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) =>
      /^\/images\/[a-zA-Z0-9/_.-]+$/.test(value) || /^https:\/\//i.test(value),
    "Укажите /images/... или https:// URL.",
  );
export const contactsSchema = z
  .object({
    address: z.string().trim().max(500).default(""),
    email: z.union([z.string().email(), z.literal("")]).default(""),
    phone: z.string().trim().max(40).default(""),
    instagram: urlOrBlank.default(""),
    website: urlOrBlank.default(""),
  })
  .strict();
export const settingsSchema = z
  .object({
    name: text(),
    city: text(),
    timezone: text().refine(
      (value) => IANAZone.isValidZone(value),
      "Некорректный часовой пояс.",
    ),
    currency: z.literal("KZT"),
    depositPercent: z.number().int().min(1).max(100),
    holdMinutes: z.number().int().min(1).max(60),
    openHour: hour,
    closeHour,
    stepMinutes: z.number().int().min(5).max(120),
    minimumMinutes: z.number().int().min(5).max(720),
    bufferBeforeMinutes: z.number().int().min(0).max(180),
    bufferAfterMinutes: z.number().int().min(0).max(180),
    reminderHours: z.array(z.number().int().min(1).max(720)).max(10),
    rulesText: text(20_000),
    rulesVersion: text(100),
    contacts: contactsSchema,
  })
  .refine(
    (value) =>
      value.minimumMinutes >= value.stepMinutes &&
      value.minimumMinutes % value.stepMinutes === 0,
    "Минимальная длительность должна быть кратна шагу записи.",
  );
export const roomSchema = z.object({
  name: text(),
  capacity: z.number().int().min(1).max(500),
});
export const locationSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  name: text(),
  description: text(5000),
  descriptionKk: z.string().trim().max(5000).default(""),
  image,
  area: z.number().int().min(1).max(10000),
  capacity: z.number().int().min(1).max(500),
  hourlyPriceMinor: amount.positive(),
  tags: z.array(text(80)).max(20),
  published: z.boolean().default(false),
  roomId: text(100),
});
export const decorSchema = z
  .object({
    locationId: text(100),
    name: text(),
    image,
    validFrom: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }).nullable().default(null),
    published: z.boolean().default(false),
  })
  .refine(
    (value) =>
      !value.validUntil ||
      new Date(value.validUntil) > new Date(value.validFrom),
    "Окончание должно быть позже начала.",
  );
export const specialistSchema = z.object({
  name: text(),
  specialty: text(500),
  hourlyPriceMinor: amount,
  published: z.boolean().default(false),
});
export const equipmentSchema = z.object({
  name: text(),
  priceMinor: amount,
  quantity: z.number().int().min(1).max(100),
  published: z.boolean().default(false),
});
export const serviceSchema = z.object({
  name: text(),
  description: text(3000),
  priceMinor: amount,
  production: z.boolean().default(false),
  published: z.boolean().default(false),
});
export const scheduleSchema = z.object({
  openHour: hour,
  closeHour,
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .transform((values) => [...new Set(values)].sort()),
});
export const closureSchema = z
  .object({
    resourceId: text(100),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    reason: text(1000),
  })
  .refine(
    (value) => new Date(value.endAt) > new Date(value.startAt),
    "Окончание должно быть позже начала.",
  );
export const exceptionSchema = z
  .object({
    resourceId: text(100),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closed: z.boolean(),
    openHour: hour.nullable().optional(),
    closeHour: closeHour.nullable().optional(),
  })
  .refine(
    (value) =>
      value.closed || (value.openHour != null && value.closeHour != null),
    "Укажите часы для открытого дня.",
  );
export const unitSchema = z.object({
  active: z.boolean(),
  maintenanceNote: z.string().trim().max(1000).default(""),
});
function optionalFields<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [
      key,
      (value as z.ZodType).optional(),
    ]),
  ) as unknown as { [K in keyof T]: z.ZodOptional<T[K]> };
}
const base = {
  operation: z.enum(["create", "update", "archive", "delete"]),
  id: text(100).optional(),
  revision: z.number().int().positive().optional(),
};
export const studioCommandSchema = z.discriminatedUnion("entity", [
  z
    .object({
      ...base,
      entity: z.literal("settings"),
      ...optionalFields(settingsSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("room"),
      ...optionalFields(roomSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("location"),
      ...optionalFields(locationSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("decor"),
      ...optionalFields(decorSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("specialist"),
      ...optionalFields(specialistSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("equipment"),
      ...optionalFields(equipmentSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("service"),
      ...optionalFields(serviceSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("schedule"),
      ...optionalFields(scheduleSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("closure"),
      ...optionalFields(closureSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("exception"),
      ...optionalFields(exceptionSchema.shape),
    })
    .strict(),
  z
    .object({
      ...base,
      entity: z.literal("unit"),
      ...optionalFields(unitSchema.shape),
    })
    .strict(),
]);
const optionalEmail = z
  .union([z.string().trim().email().max(254), z.literal(""), z.null()])
  .optional()
  .transform((value) => value?.toLowerCase() || null);
const optionalPhone = z
  .union([z.string().trim().max(40), z.null()])
  .optional()
  .transform((value) => value || null);
export const customerSchema = z
  .object({
    name: text(),
    email: optionalEmail,
    phone: optionalPhone,
    notes: z.string().trim().max(10_000).default(""),
    tags: z.array(text(60)).max(30).default([]),
  })
  .strict();
export type StudioCommand = z.input<typeof studioCommandSchema>;
