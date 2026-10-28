import "dotenv/config";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Actor, BookingInput } from "../../src/lib/domain/types";
import { seedCatalog } from "../../prisma/seed";

let db: PrismaClient;
let domain: typeof import("../../src/lib/domain");
let studio: typeof import("../../src/lib/studio");
let customers: typeof import("../../src/lib/studio/customers");
const originalDatabaseURL = process.env.DATABASE_URL;
const owner: Actor = { id: "management-owner", role: "OWNER" };
const admin: Actor = { id: "management-admin", role: "ADMIN" };
const client: Actor = { id: "management-client", role: "CLIENT" };
const specialist: Actor = { id: "management-specialist", role: "SPECIALIST" };
const shoot = DateTime.now()
  .setZone("Asia/Almaty")
  .plus({ days: 21 })
  .startOf("day")
  .set({ hour: 10 });
const iso = (date = shoot) => date.toUTC().toISO()!;
const bookingInput = (overrides: Partial<BookingInput> = {}): BookingInput => ({
  locationId: "daylight",
  startAt: iso(),
  durationMinutes: 60,
  serviceIds: [],
  equipmentIds: [],
  purpose: "photo",
  guests: 4,
  name: "Участник теста",
  phone: "+70000000001",
  comment: "Management integration fixture",
  acceptRules: true,
  ...overrides,
});
const command = (raw: Record<string, unknown>, actor = owner) =>
  studio.mutateStudio(raw, actor);
function manualInput(
  customerId: string,
  overrides: Partial<BookingInput> = {},
) {
  const { name: _name, phone: _phone, ...selection } = bookingInput(overrides);
  return {
    ...selection,
    customerId,
    source: "phone",
    idempotencyKey: randomUUID(),
  };
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || process.env.NODE_ENV === "production")
    throw new Error("Management tests require a dedicated TEST_DATABASE_URL.");
  const parsed = new URL(url);
  if (
    !parsed.pathname.endsWith("_test") ||
    parsed.pathname === new URL(originalDatabaseURL!).pathname
  ) {
    throw new Error(
      "Refusing to use the application database for destructive integration fixtures.",
    );
  }
  process.env.DATABASE_URL = url;
  process.env.PAYMENT_MODE = "test";
  execFileSync(
    process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
  ({ db } = await import("../../src/lib/db"));
  domain = await import("../../src/lib/domain");
  studio = await import("../../src/lib/studio");
  customers = await import("../../src/lib/studio/customers");
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "User", "Customer", "Resource", "StudioSettings", "Service", "Lead", "AuditEvent", "Consent", "Verification", "RateLimit" RESTART IDENTITY CASCADE',
  );
  await seedCatalog(db);
  await db.user.createMany({
    data: [owner, admin, client, specialist].map((actor) => ({
      ...actor,
      name: actor.id,
      email: `${actor.id}@frame.test`,
      emailVerified: true,
    })),
  });
});

afterAll(async () => {
  await db?.$disconnect();
  if (originalDatabaseURL) process.env.DATABASE_URL = originalDatabaseURL;
  else delete process.env.DATABASE_URL;
});

async function guest(overrides: Record<string, unknown> = {}) {
  return customers.createCustomer(
    {
      name: "Гостевой клиент",
      email: "guest@frame.test",
      phone: "+70000000002",
      notes: "INTERNAL_ONLY_7b41",
      tags: ["тест"],
      ...overrides,
    },
    owner,
  );
}

describe("studio administration preserves reservations and customer boundaries", () => {
  it("honors configured capacity above one hundred and rejects guests exceeding the location limit", async () => {
    const room = await db.room.findUniqueOrThrow({
      where: { id: "room-light" },
    });
    await command({
      entity: "room",
      operation: "update",
      id: room.id,
      revision: room.revision,
      capacity: 200,
    });
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    await command({
      entity: "location",
      operation: "update",
      id: location.id,
      revision: location.revision,
      capacity: 200,
    });
    const booking = await domain.createBooking(
      bookingInput({ guests: 150 }),
      client.id,
    );
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .guests,
    ).toBe(150);
    await expect(
      domain.createBooking(
        bookingInput({ guests: 201, startAt: iso(shoot.plus({ hours: 3 })) }),
        client.id,
      ),
    ).rejects.toMatchObject({ code: "CAPACITY" });
    expect(await db.booking.count()).toBe(1);
  });

  it("honors a configured fifteen-minute minimum throughout availability, quote and booking", async () => {
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await command({
      entity: "settings",
      operation: "update",
      revision: settings.revision,
      minimumMinutes: 15,
      stepMinutes: 15,
    });
    const availability = await domain.getAvailability({
      locationId: "daylight",
      date: shoot.toISODate()!,
      durationMinutes: 15,
    });
    const slot = availability.slots.find((item) => item.available)!;
    expect(slot).toBeTruthy();
    const quote = await domain.calculateQuote({
      locationId: "daylight",
      startAt: slot.startAt,
      durationMinutes: 15,
      purpose: "photo",
      guests: 1,
      serviceIds: [],
      equipmentIds: [],
    });
    const booking = await domain.createBooking(
      bookingInput({
        startAt: slot.startAt,
        durationMinutes: 15,
        guests: 1,
        expectedQuoteFingerprint: quote.fingerprint,
      }),
      client.id,
    );
    expect(
      new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime(),
    ).toBe(15 * 60_000);
    expect(booking.totalMinor).toBe(quote.totalMinor);
  });

  it("hides wholly unavailable equipment from the public catalog while preserving staff inventory", async () => {
    const units = await db.resourceUnit.findMany({
      where: { resourceId: "light-resource", retiredAt: null },
    });
    for (const unit of units)
      await command({
        entity: "unit",
        operation: "update",
        id: unit.id,
        revision: unit.revision,
        active: false,
        maintenanceNote: "Обслуживание",
      });
    expect(
      (await domain.getCatalog()).equipment.some((item) => item.id === "light"),
    ).toBe(false);
    const staff = await studio.getAdminStudio(owner);
    expect(staff.equipment.some((item) => item.id === "light")).toBe(true);
    expect(
      staff.resources.find((item) => item.id === "light-resource")?.units,
    ).toHaveLength(2);
  });

  it("rejects zero tariffs and rounded zero deposits without creating a hold", async () => {
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    await expect(
      command({
        entity: "location",
        operation: "update",
        id: location.id,
        revision: location.revision,
        hourlyPriceMinor: 0,
      }),
    ).rejects.toThrow();
    await db.location.update({
      where: { id: location.id },
      data: { hourlyPriceMinor: 0 },
    });
    await expect(
      domain.createBooking(bookingInput(), client.id),
    ).rejects.toMatchObject({ code: "NONPOSITIVE_PRICE" });
    await db.location.update({
      where: { id: location.id },
      data: { hourlyPriceMinor: 1 },
    });
    await db.studioSettings.update({
      where: { id: "studio" },
      data: { depositPercent: 1 },
    });
    await expect(
      domain.createBooking(bookingInput(), client.id),
    ).rejects.toMatchObject({ code: "NONPOSITIVE_PRICE" });
    expect(await db.booking.count()).toBe(0);
    expect(await db.allocation.count()).toBe(0);
  });

  it("requires refreshed consent after rules or deposit change even when the total stays unchanged", async () => {
    const {
      name: _name,
      phone: _phone,
      comment: _comment,
      acceptRules: _acceptRules,
      ...selection
    } = bookingInput();
    const quote = await domain.calculateQuote(selection);
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await command({
      entity: "settings",
      operation: "update",
      revision: settings.revision,
      rulesText: "Обновлённые условия до создания",
      rulesVersion: "consent-v2",
      depositPercent: 50,
    });
    await expect(
      domain.createBooking(
        bookingInput({
          expectedTotalMinor: quote.totalMinor,
          expectedQuoteFingerprint: quote.fingerprint,
        }),
        client.id,
      ),
    ).rejects.toMatchObject({ code: "QUOTE_CHANGED", status: 409 });
    expect(await db.booking.count()).toBe(0);
    const refreshed = await domain.calculateQuote(selection);
    expect(refreshed.totalMinor).toBe(quote.totalMinor);
    expect(refreshed.fingerprint).not.toBe(quote.fingerprint);
    const booking = await domain.createBooking(
      bookingInput({
        expectedTotalMinor: refreshed.totalMinor,
        expectedQuoteFingerprint: refreshed.fingerprint,
      }),
      client.id,
    );
    expect(booking.depositMinor).toBe(refreshed.depositMinor);
  });

  it("allows only the owner to change settings and rejects stale revisions", async () => {
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    const update = {
      entity: "settings",
      operation: "update",
      id: "studio",
      revision: settings.revision,
      name: "Новое имя тестовой студии",
    };
    for (const actor of [admin, client, specialist])
      await expect(command(update, actor)).rejects.toMatchObject({
        status: 403,
      });
    await command(update);
    await expect(
      command({ ...update, name: "Устаревшая правка" }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(
      (await db.studioSettings.findUniqueOrThrow({ where: { id: "studio" } }))
        .name,
    ).toBe(update.name);
  });

  it("rejects invalid timezone and incompatible recording steps without changing settings", async () => {
    const before = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await expect(
      command({
        entity: "settings",
        operation: "update",
        id: "studio",
        revision: before.revision,
        timezone: "Invalid/Nowhere",
      }),
    ).rejects.toThrow();
    await expect(
      command({
        entity: "settings",
        operation: "update",
        id: "studio",
        revision: before.revision,
        stepMinutes: 45,
        minimumMinutes: 60,
      }),
    ).rejects.toThrow();
    expect(
      await db.studioSettings.findUniqueOrThrow({ where: { id: "studio" } }),
    ).toEqual(before);
  });

  it("uses new settings and tariffs for new bookings while preserving previous snapshots", async () => {
    const first = await domain.createBooking(bookingInput(), client.id);
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await command({
      entity: "settings",
      operation: "update",
      id: "studio",
      revision: settings.revision,
      depositPercent: 50,
      rulesText: "Новые тестовые правила",
      rulesVersion: "integration-v2",
    });
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    await command({
      entity: "location",
      operation: "update",
      id: location.id,
      revision: location.revision,
      hourlyPriceMinor: location.hourlyPriceMinor + 100_000,
    });
    const second = await domain.createBooking(
      bookingInput({ startAt: iso(shoot.plus({ hours: 3 })) }),
      client.id,
    );
    const unchanged = await db.booking.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(unchanged.totalMinor).toBe(first.totalMinor);
    expect(unchanged.depositMinor).toBe(first.depositMinor);
    expect(unchanged.rulesVersion).toBe(first.rulesVersion);
    expect(second.totalMinor).toBe(first.totalMinor + 100_000);
    expect(second.depositMinor).toBe(Math.round(second.totalMinor / 2));
    expect(second.rulesVersion).toBe("integration-v2");
  });

  it("rejects a changed expected quote instead of silently accepting a new tariff", async () => {
    const quote = await domain.calculateQuote(bookingInput());
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    await command({
      entity: "location",
      operation: "update",
      id: location.id,
      revision: location.revision,
      hourlyPriceMinor: location.hourlyPriceMinor + 100_000,
    });
    await expect(
      domain.createBooking(
        bookingInput({ expectedTotalMinor: quote.totalMinor }),
        client.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.booking.count()).toBe(0);
  });

  it("reports affected bookings when closing a shared physical hall without canceling them", async () => {
    const booking = await domain.createBooking(bookingInput(), client.id);
    await expect(
      command({
        entity: "closure",
        operation: "create",
        resourceId: "room-light-resource",
        startAt: iso(),
        endAt: iso(shoot.plus({ hours: 2 })),
        reason: "Ремонт",
      }),
    ).rejects.toMatchObject({
      code: "BOOKING_CONFLICT",
      status: 409,
      details: {
        conflicts: expect.arrayContaining([
          expect.objectContaining({ id: booking.id, number: booking.number }),
        ]),
      },
    });
    expect(await db.resourceClosure.count()).toBe(0);
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("awaiting_payment");
  });

  it("protects active bookings against schedule, capacity, and archive changes", async () => {
    const booking = await domain.createBooking(bookingInput(), client.id);
    const resource = await db.resource.findUniqueOrThrow({
      where: { id: "room-light-resource" },
    });
    const room = await db.room.findUniqueOrThrow({
      where: { id: "room-light" },
    });
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    for (const change of [
      {
        entity: "schedule",
        operation: "update",
        id: resource.id,
        revision: resource.revision,
        openHour: 12,
        closeHour: 22,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
      {
        entity: "room",
        operation: "update",
        id: room.id,
        revision: room.revision,
        capacity: 2,
      },
      {
        entity: "location",
        operation: "archive",
        id: location.id,
        revision: location.revision,
      },
    ])
      await expect(command(change)).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("awaiting_payment");
    expect(
      (await db.resource.findUniqueOrThrow({ where: { id: resource.id } }))
        .openHour,
    ).toBe(resource.openHour);
    expect(
      (await db.room.findUniqueOrThrow({ where: { id: room.id } })).capacity,
    ).toBe(room.capacity);
  });

  it("honors date exceptions and specialist absence in public availability", async () => {
    await command({
      entity: "exception",
      operation: "create",
      resourceId: "photographer-resource",
      date: shoot.toISODate(),
      closed: true,
    });
    await expect(
      domain.createBooking(
        bookingInput({ specialistId: "photographer" }),
        client.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const availability = await domain.getAvailability({
      locationId: "daylight",
      date: shoot.toISODate()!,
      durationMinutes: 60,
      specialistId: "photographer",
    });
    expect(availability.slots.some((slot) => slot.available)).toBe(false);
    expect(
      (
        await domain.getAvailability({
          locationId: "daylight",
          date: shoot.toISODate()!,
          durationMinutes: 60,
        })
      ).slots.some((slot) => slot.available),
    ).toBe(true);
  });

  it("excludes maintained equipment and prevents disabling a unit already reserved", async () => {
    const units = await db.resourceUnit.findMany({
      where: { resourceId: "light-resource" },
      orderBy: { serial: "asc" },
    });
    await command({
      entity: "unit",
      operation: "update",
      id: units[0].id,
      revision: units[0].revision,
      active: false,
      maintenanceNote: "Обслуживание",
    });
    await expect(
      domain.createBooking(
        bookingInput({ equipmentIds: ["light", "light"] }),
        client.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const booking = await domain.createBooking(
      bookingInput({ equipmentIds: ["light"] }),
      client.id,
    );
    await expect(
      command({
        entity: "unit",
        operation: "update",
        id: units[1].id,
        revision: units[1].revision,
        active: false,
        maintenanceNote: "Обслуживание",
      }),
    ).rejects.toMatchObject({ code: "BOOKING_CONFLICT", status: 409 });
    expect(
      await db.allocation.count({
        where: { bookingId: booking.id, unitId: units[1].id, releasedAt: null },
      }),
    ).toBe(1);
  });

  it("archives an unused location without removing existing order and payment history", async () => {
    const booking = await domain.createBooking(bookingInput(), client.id);
    await domain.recordPayment(
      booking.id,
      {
        amountMinor: booking.depositMinor,
        method: "MANUAL",
        idempotencyKey: randomUUID(),
        comment: "Тест",
      },
      owner,
    );
    await domain.cancelBooking(booking.id, owner);
    const location = await db.location.findUniqueOrThrow({
      where: { id: "daylight" },
    });
    await command({
      entity: "location",
      operation: "archive",
      id: location.id,
      revision: location.revision,
    });
    expect(
      (await domain.getCatalog()).locations.some(
        (item) => item.id === location.id,
      ),
    ).toBe(false);
    expect(await db.booking.count({ where: { id: booking.id } })).toBe(1);
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(
      1,
    );
    expect((await domain.getBooking(booking.id, client)).id).toBe(booking.id);
  });

  it("keeps current and future decor periods distinct and rejects overlapping published versions", async () => {
    const old = await db.decorVersion.findUniqueOrThrow({
      where: { id: "daylight-v1" },
    });
    const boundary = shoot.plus({ days: 1 }).startOf("day");
    await command({
      entity: "decor",
      operation: "update",
      id: old.id,
      revision: old.revision,
      validUntil: iso(boundary),
    });
    await command({
      entity: "decor",
      operation: "create",
      locationId: "daylight",
      name: "Будущее оформление",
      image: "/images/daylight.svg",
      validFrom: iso(boundary),
      validUntil: null,
      published: true,
    });
    expect((await domain.calculateQuote(bookingInput())).version.id).toBe(
      old.id,
    );
    expect(
      (
        await domain.calculateQuote(
          bookingInput({ startAt: iso(shoot.plus({ days: 2 })) }),
        )
      ).version.name,
    ).toBe("Будущее оформление");
    await expect(
      command({
        entity: "decor",
        operation: "create",
        locationId: "daylight",
        name: "Пересечение",
        image: "/images/daylight.svg",
        validFrom: iso(),
        validUntil: iso(shoot.plus({ hours: 3 })),
        published: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("never links a guest customer to an account merely because email or phone matches", async () => {
    const customer = await guest({ email: `${client.id}@frame.test` });
    const booking = await studio.createManualBooking(
      manualInput(customer.id),
      owner,
    );
    const record = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(record.userId).toBeNull();
    expect(record.customerId).toBe(customer.id);
    expect(record.source).toBe("phone");
    await expect(domain.getBooking(booking.id, client)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("allows only one concurrent staff/public booking for a shared hall", async () => {
    const customer = await guest();
    const results = await Promise.allSettled([
      domain.createBooking(bookingInput({ locationId: "seasonal" }), client.id),
      studio.createManualBooking(manualInput(customer.id), owner),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(["TIME_CONFLICT", "RESOURCE_UNAVAILABLE"]).toContain(
      rejected.reason.code,
    );
    expect(await db.booking.count()).toBe(1);
  });

  it("makes concurrent manual retries idempotent and rejects changed payload reuse", async () => {
    const customer = await guest();
    const payload = manualInput(customer.id);
    const [first, retry] = await Promise.all([
      studio.createManualBooking(payload, owner),
      studio.createManualBooking(payload, owner),
    ]);
    expect(retry.id).toBe(first.id);
    expect(await db.booking.count()).toBe(1);
    await expect(
      studio.createManualBooking(
        { ...payload, startAt: iso(shoot.plus({ hours: 3 })) },
        owner,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.booking.count()).toBe(1);
  });

  it("makes concurrent public booking retries idempotent", async () => {
    const payload = bookingInput({ idempotencyKey: randomUUID() });
    const [first, retry] = await Promise.all([
      domain.createBooking(payload, client.id),
      domain.createBooking(payload, client.id),
    ]);
    expect(first.id).toBe(retry.id);
    expect(await db.booking.count()).toBe(1);
  });

  it("serializes a new technical closure against a simultaneous reservation", async () => {
    const results = await Promise.allSettled([
      command({
        entity: "closure",
        operation: "create",
        resourceId: "room-light-resource",
        startAt: iso(),
        endAt: iso(shoot.plus({ hours: 2 })),
        reason: "Подготовка",
      }),
      domain.createBooking(bookingInput(), client.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await db.booking.count()) + (await db.resourceClosure.count()),
    ).toBe(1);
  });

  it("keeps internal notes out of client responses and rejects client/specialist customer access", async () => {
    const booking = await domain.createBooking(bookingInput(), client.id);
    const record = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(record.customerId).toBeTruthy();
    await db.customer.update({
      where: { id: record.customerId! },
      data: { notes: "INTERNAL_ONLY_7b41" },
    });
    expect(
      JSON.stringify(await domain.getBooking(booking.id, client)),
    ).not.toContain("INTERNAL_ONLY_7b41");
    for (const actor of [client, specialist]) {
      await expect(customers.listCustomers("", actor)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        customers.getCustomer(record.customerId!, actor),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        customers.createCustomer({ name: "Запрещённый клиент" }, actor),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("does not restore a maintenance unit to service when equipment quantity is reduced and raised", async () => {
    const secondUnit = await db.resourceUnit.findUniqueOrThrow({
      where: { resourceId_serial: { resourceId: "light-resource", serial: 2 } },
    });
    await command({
      entity: "unit",
      operation: "update",
      id: secondUnit.id,
      revision: secondUnit.revision,
      active: false,
      maintenanceNote: "Ждёт ремонта",
    });
    const equipment = await db.equipment.findUniqueOrThrow({
      where: { id: "light" },
    });
    await command({
      entity: "equipment",
      operation: "update",
      id: equipment.id,
      revision: equipment.revision,
      quantity: 1,
    });
    const reduced = await db.equipment.findUniqueOrThrow({
      where: { id: "light" },
    });
    await command({
      entity: "equipment",
      operation: "update",
      id: reduced.id,
      revision: reduced.revision,
      quantity: 2,
    });
    const restored = await db.resourceUnit.findUniqueOrThrow({
      where: { id: secondUnit.id },
    });
    expect(restored.active).toBe(false);
    expect(restored.maintenanceNote).toContain("ремонт");
    expect(restored.retiredAt).not.toBeNull();
    const currentUnits = await db.resourceUnit.findMany({
      where: { resourceId: "light-resource", retiredAt: null },
    });
    expect(currentUnits).toHaveLength(2);
    expect(currentUnits.some((unit) => unit.id === secondUnit.id)).toBe(false);
  });

  it("rechecks current timezone schedules for a late payment while preserving the original instant", async () => {
    const booking = await domain.createBooking(bookingInput(), client.id);
    const expiredAt = new Date(Date.now() - 1000);
    await db.booking.update({
      where: { id: booking.id },
      data: { expiresAt: expiredAt },
    });
    await db.allocation.updateMany({
      where: { bookingId: booking.id },
      data: { expiresAt: expiredAt },
    });
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await command({
      entity: "settings",
      operation: "update",
      id: "studio",
      revision: settings.revision,
      timezone: "UTC",
    });
    const result = await domain.recordPayment(
      booking.id,
      {
        amountMinor: booking.depositMinor,
        method: "MANUAL",
        idempotencyKey: randomUUID(),
        comment: "Поздний тестовый платёж",
      },
      owner,
    );
    expect(result.status).toBe("expired");
    expect(result.needsReview).toBe(true);
    expect(result.startAt).toBe(booking.startAt);
    expect(
      await db.task.count({
        where: { bookingId: booking.id, kind: "late_payment", status: "open" },
      }),
    ).toBe(1);
  });

  it("cannot move an opening-hours exception away from a resource with an existing booking", async () => {
    const settings = await db.studioSettings.findUniqueOrThrow({
      where: { id: "studio" },
    });
    await command({
      entity: "settings",
      operation: "update",
      id: "studio",
      revision: settings.revision,
      openHour: 6,
    });
    await command({
      entity: "exception",
      operation: "create",
      resourceId: "room-light-resource",
      date: shoot.toISODate(),
      closed: false,
      openHour: 6,
      closeHour: 22,
    });
    const exception = await db.resourceScheduleException.findFirstOrThrow({
      where: { resourceId: "room-light-resource" },
    });
    const booking = await domain.createBooking(
      bookingInput({ startAt: iso(shoot.set({ hour: 7 })) }),
      client.id,
    );
    await expect(
      command({
        entity: "exception",
        operation: "update",
        id: exception.id,
        revision: exception.revision,
        resourceId: "room-loft-resource",
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.resourceScheduleException.findUniqueOrThrow({
          where: { id: exception.id },
        })
      ).resourceId,
    ).toBe("room-light-resource");
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("awaiting_payment");
  });

  it("rejects hidden userId assignment and shows duplicates without merging customer records", async () => {
    await expect(
      customers.createCustomer({ name: "Подмена", userId: client.id }, owner),
    ).rejects.toThrow();
    const first = await guest();
    const duplicate = await guest({ name: "Возможный дубль" });
    expect(first.id).not.toBe(duplicate.id);
    const details = await customers.getCustomer(first.id, owner);
    expect(details.possibleDuplicates.map((item) => item.id)).toContain(
      duplicate.id,
    );
    expect(await db.customer.count()).toBe(2);
    const updated = await customers.updateCustomer(
      first.id,
      {
        name: "Изменённый клиент",
        email: "guest@frame.test",
        phone: "+70000000002",
        notes: "Внутренняя заметка",
        tags: [],
        revision: first.revision,
      },
      owner,
    );
    await expect(
      customers.updateCustomer(
        first.id,
        { name: "Устаревшее изменение", revision: first.revision },
        owner,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await customers.archiveCustomer(
      first.id,
      { revision: updated.revision, archived: true },
      owner,
    );
    expect(
      (await customers.getCustomer(first.id, owner)).archivedAt,
    ).not.toBeNull();
    expect(
      await db.auditEvent.count({
        where: { entityType: "Customer", entityId: first.id },
      }),
    ).toBe(3);
  });
});
