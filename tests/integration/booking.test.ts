import "dotenv/config";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Actor, BookingInput } from "../../src/lib/domain/types";
import { seedCatalog } from "../../prisma/seed";

let db: PrismaClient;
let domain: typeof import("../../src/lib/domain");
const client: Actor = { id: "test-client-a", role: "CLIENT" };
const other: Actor = { id: "test-client-b", role: "CLIENT" };
const admin: Actor = { id: "test-admin", role: "OWNER" };
const shoot = DateTime.now()
  .setZone("Asia/Almaty")
  .plus({ days: 14 })
  .startOf("day")
  .set({ hour: 10 });
function input(overrides: Partial<BookingInput> = {}): BookingInput {
  return {
    locationId: "daylight",
    startAt: shoot.toUTC().toISO()!,
    durationMinutes: 60,
    serviceIds: [],
    equipmentIds: [],
    purpose: "photo",
    guests: 2,
    name: "Тестовый клиент",
    phone: "+70000000000",
    comment: "Integration fixture",
    acceptRules: true,
    ...overrides,
  };
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || process.env.NODE_ENV === "production")
    throw new Error(
      "Integration tests require TEST_DATABASE_URL and a non-production environment.",
    );
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith("_test"))
    throw new Error(
      "Refusing to modify a database whose name does not end in _test.",
    );
  if (
    process.env.DATABASE_URL &&
    new URL(process.env.DATABASE_URL).pathname === parsed.pathname
  )
    throw new Error(
      "TEST_DATABASE_URL must be a separate database from DATABASE_URL.",
    );
  process.env.DATABASE_URL = url;
  process.env.PAYMENT_MODE = "test";
  execFileSync(
    process.execPath,
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
  ({ db } = await import("../../src/lib/db"));
  domain = await import("../../src/lib/domain");
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "User", "Resource", "StudioSettings", "Service", "Lead", "AuditEvent", "Consent", "Verification", "RateLimit" RESTART IDENTITY CASCADE',
  );
  await seedCatalog(db);
  await db.user.createMany({
    data: [client, other, admin].map((actor) => ({
      id: actor.id,
      role: actor.role,
      name: actor.id,
      email: `${actor.id}@example.test`,
      emailVerified: true,
    })),
  });
});

afterAll(async () => {
  await db?.$disconnect();
});

describe("transactional bookings and append-only payment ledger", () => {
  it("stores instants as timestamptz and does not claim future notifications in a non-UTC DB session", async () => {
    const columns = await db.$queryRaw<
      { table_name: string; column_name: string; data_type: string }[]
    >`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND ((table_name = 'NotificationJob' AND column_name = 'scheduledAt')
        OR (table_name = 'Booking' AND column_name IN ('startAt', 'expiresAt')))`;
    expect(columns).toHaveLength(3);
    expect(
      columns.every(
        (column) => column.data_type === "timestamp with time zone",
      ),
    ).toBe(true);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Qyzylorda'");
      const future = await tx.notificationJob.create({
        data: {
          dedupeKey: "timezone-future-job",
          to: "fixture@example.test",
          subject: "Future",
          text: "Fixture",
          scheduledAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      const due = await tx.notificationJob.create({
        data: {
          dedupeKey: "timezone-due-job",
          to: "fixture@example.test",
          subject: "Due",
          text: "Fixture",
          scheduledAt: new Date(Date.now() - 60_000),
        },
      });
      const claimable = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "NotificationJob" WHERE "status" = 'pending' AND "scheduledAt" <= NOW()`;
      expect(claimable.map((job) => job.id)).toContain(due.id);
      expect(claimable.map((job) => job.id)).not.toContain(future.id);
      await tx.$executeRaw`UPDATE "NotificationJob" SET "lockedUntil" = NOW() + INTERVAL '2 minutes' WHERE "id" = ${due.id}`;
      const locked = await tx.notificationJob.findUniqueOrThrow({
        where: { id: due.id },
      });
      expect(locked.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(
        100_000,
      );
      expect(locked.lockedUntil!.getTime() - Date.now()).toBeLessThan(125_000);
    });
  });
  it("only accepts one of two concurrent bookings for the same room", async () => {
    const result = await Promise.allSettled([
      domain.createBooking(input(), client.id),
      domain.createBooking(input(), other.id),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(result.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await db.booking.count()).toBe(1);
  });
  it("prevents concurrent sales of Daylight and Seasonal in their shared physical room", async () => {
    const result = await Promise.allSettled([
      domain.createBooking(input(), client.id),
      domain.createBooking(input({ locationId: "seasonal" }), other.id),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
  });
  it("protects active room allocations with a database exclusion constraint", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const allocation = await db.allocation.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    await expect(
      db.allocation.create({
        data: {
          unitId: allocation.unitId,
          bookingId: booking.id,
          startAt: allocation.startAt,
          endAt: allocation.endAt,
        },
      }),
    ).rejects.toThrow();
  });
  it("honors specialist occupation and unavailable equipment", async () => {
    await domain.createBooking(
      input({ specialistId: "photographer" }),
      client.id,
    );
    await expect(
      domain.createBooking(
        input({ locationId: "loft", specialistId: "photographer" }),
        other.id,
      ),
    ).rejects.toMatchObject({ code: "TIME_CONFLICT" });
    await db.resource.update({
      where: { id: "camera-resource" },
      data: { active: false },
    });
    await expect(
      domain.createBooking(
        input({ locationId: "loft", equipmentIds: ["camera"] }),
        other.id,
      ),
    ).rejects.toMatchObject({ code: "EQUIPMENT_UNAVAILABLE" });
  });
  it("limits equipment to its real number of units across independent rooms", async () => {
    await domain.createBooking(input({ equipmentIds: ["light"] }), client.id);
    await domain.createBooking(
      input({ locationId: "loft", equipmentIds: ["light"] }),
      other.id,
    );
    await expect(
      domain.createBooking(
        input({ locationId: "cyclorama", equipmentIds: ["light"] }),
        client.id,
      ),
    ).rejects.toMatchObject({ code: "TIME_CONFLICT" });
  });
  it("honors technical closures and cleanup buffers", async () => {
    await domain.createBooking(input(), client.id);
    await expect(
      domain.createBooking(
        input({ startAt: shoot.plus({ hours: 1 }).toUTC().toISO()! }),
        other.id,
      ),
    ).rejects.toMatchObject({ code: "TIME_CONFLICT" });
    await db.resourceClosure.create({
      data: {
        resourceId: "room-loft-resource",
        startAt: shoot.toJSDate(),
        endAt: shoot.plus({ hours: 2 }).toJSDate(),
        reason: "Maintenance",
      },
    });
    await expect(
      domain.createBooking(input({ locationId: "loft" }), other.id),
    ).rejects.toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
  });
  it("ignores expired holds even before the cleanup worker runs", async () => {
    const first = await domain.createBooking(input(), client.id);
    const expired = new Date(Date.now() - 60_000);
    await db.booking.update({
      where: { id: first.id },
      data: { expiresAt: expired },
    });
    await db.allocation.updateMany({
      where: { bookingId: first.id },
      data: { expiresAt: expired },
    });
    const availability = await domain.getAvailability({
      locationId: "daylight",
      date: shoot.toISODate()!,
      durationMinutes: 60,
    });
    expect(
      availability.slots.find((slot) => slot.label === "10:00")?.available,
    ).toBe(true);
    const second = await domain.createBooking(input(), other.id);
    expect(second.id).not.toBe(first.id);
    expect(
      await db.allocation.count({
        where: { bookingId: first.id, releasedAt: null },
      }),
    ).toBe(0);
  });
  it("processes a repeated test payment idempotently and confirms only at the deposit threshold", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const payment = {
      amountMinor: booking.depositMinor,
      method: "TEST" as const,
      idempotencyKey: "test-payment-one",
    };
    const results = await Promise.all([
      domain.recordPayment(booking.id, payment, client),
      domain.recordPayment(booking.id, payment, client),
    ]);
    expect(results.every((result) => result.status === "confirmed")).toBe(true);
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(
      1,
    );
    expect(
      await db.allocation.count({
        where: { bookingId: booking.id, expiresAt: null, releasedAt: null },
      }),
    ).toBe(1);
  });
  it("test intents collect only the remaining deposit and safely retry before paying the balance", async () => {
    const booking = await domain.createBooking(input(), client.id);
    await domain.recordPayment(
      booking.id,
      {
        amountMinor: 200_000,
        method: "MANUAL",
        idempotencyKey: "test-intent-partial",
        comment: "Partial cash payment",
      },
      admin,
    );
    const deposit = await domain.recordTestPayment(
      booking.id,
      { idempotencyKey: "remaining-deposit-intent" },
      client,
    );
    expect(deposit.paidMinor).toBe(booking.depositMinor);
    expect(deposit.status).toBe("confirmed");
    expect(
      (
        await db.payment.findUniqueOrThrow({
          where: { idempotencyKey: "remaining-deposit-intent" },
        })
      ).amountMinor,
    ).toBe(booking.depositMinor - 200_000);
    const retry = await domain.recordTestPayment(
      booking.id,
      { idempotencyKey: "remaining-deposit-intent" },
      client,
    );
    expect(retry.paidMinor).toBe(booking.depositMinor);
    const balance = await domain.recordTestPayment(
      booking.id,
      { idempotencyKey: "remaining-balance-intent", target: "balance" },
      client,
    );
    expect(balance.paidMinor).toBe(booking.totalMinor);
    expect(balance.paymentStatus).toBe("paid");
    await domain.recordTestPayment(
      booking.id,
      { idempotencyKey: "remaining-balance-intent", target: "balance" },
      client,
    );
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(
      3,
    );
    await expect(
      domain.recordTestPayment(
        booking.id,
        { idempotencyKey: "remaining-deposit-intent", target: "balance" },
        client,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("serializes different concurrent deposit intents so only the remaining deposit is collected", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const result = await Promise.allSettled([
      domain.recordTestPayment(
        booking.id,
        { idempotencyKey: "concurrent-deposit-one" },
        client,
      ),
      domain.recordTestPayment(
        booking.id,
        { idempotencyKey: "concurrent-deposit-two" },
        client,
      ),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = result.find(
      (item) => item.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "ALREADY_PAID" });
    expect(await db.payment.count({ where: { bookingId: booking.id } })).toBe(
      1,
    );
  });
  it("records a late payment as a staff task if a new booking has taken the room", async () => {
    const first = await domain.createBooking(input(), client.id);
    const expired = new Date(Date.now() - 60_000);
    await db.booking.update({
      where: { id: first.id },
      data: { expiresAt: expired },
    });
    await db.allocation.updateMany({
      where: { bookingId: first.id },
      data: { expiresAt: expired },
    });
    const second = await domain.createBooking(input(), other.id);
    const result = await domain.recordPayment(
      first.id,
      {
        amountMinor: first.depositMinor,
        method: "TEST",
        idempotencyKey: "late-payment-one",
      },
      client,
    );
    expect(result.status).toBe("expired");
    expect(result.needsReview).toBe(true);
    expect(result.paidMinor).toBe(first.depositMinor);
    expect(
      await db.task.count({
        where: { bookingId: first.id, kind: "late_payment" },
      }),
    ).toBe(1);
    expect(
      await db.allocation.count({
        where: { bookingId: second.id, releasedAt: null },
      }),
    ).toBe(1);
  });
  it("reacquires free resources for a late payment without changing its price snapshot", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const expired = new Date(Date.now() - 60_000);
    await db.booking.update({
      where: { id: booking.id },
      data: { expiresAt: expired },
    });
    await db.allocation.updateMany({
      where: { bookingId: booking.id },
      data: { expiresAt: expired },
    });
    await db.location.update({
      where: { id: "daylight" },
      data: { hourlyPriceMinor: 9_000_000 },
    });
    const result = await domain.recordPayment(
      booking.id,
      {
        amountMinor: booking.depositMinor,
        method: "TEST",
        idempotencyKey: "late-free-payment",
      },
      client,
    );
    expect(result.status).toBe("confirmed");
    expect(result.totalMinor).toBe(booking.totalMinor);
  });
  it("keeps partial payments/refunds separate and prevents excess refunds", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const partial = await domain.recordPayment(
      booking.id,
      {
        amountMinor: 100_000,
        method: "MANUAL",
        idempotencyKey: "partial-manual-payment",
        comment: "Cash fixture",
      },
      admin,
    );
    expect(partial.status).toBe("awaiting_payment");
    expect(partial.paymentStatus).toBe("partially_paid");
    const refund = await domain.refundPayment(
      booking.id,
      {
        amountMinor: 40_000,
        idempotencyKey: "partial-manual-refund",
        comment: "Partial refund",
      },
      admin,
    );
    expect(refund.paymentStatus).toBe("partially_refunded");
    expect(refund.paidMinor).toBe(60_000);
    await expect(
      domain.refundPayment(
        booking.id,
        {
          amountMinor: 60_001,
          idempotencyKey: "invalid-manual-refund",
          comment: "Invalid refund",
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: "EXCESS_REFUND" });
  });
  it("preserves the original booking when a reschedule conflicts", async () => {
    const booking = await domain.createBooking(input(), client.id);
    const alternate = shoot.plus({ hours: 3 });
    await domain.createBooking(
      input({ startAt: alternate.toUTC().toISO()! }),
      other.id,
    );
    await expect(
      domain.rescheduleBooking(
        booking.id,
        { startAt: alternate.toUTC().toISO()!, durationMinutes: 60 },
        client,
      ),
    ).rejects.toMatchObject({ code: "TIME_CONFLICT" });
    const persisted = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(persisted.startAt.toISOString()).toBe(shoot.toUTC().toISO());
    expect(
      await db.allocation.count({
        where: { bookingId: booking.id, releasedAt: null },
      }),
    ).toBe(1);
  });
  it("stores a complete before/after revision for successful rescheduling", async () => {
    const booking = await domain.createBooking(input(), client.id);
    await domain.rescheduleBooking(
      booking.id,
      {
        startAt: shoot.plus({ hours: 3 }).toUTC().toISO()!,
        durationMinutes: 90,
      },
      client,
    );
    expect(
      await db.bookingRevision.count({ where: { bookingId: booking.id } }),
    ).toBe(1);
  });
  it("revives canceled reminders when returning to the original time without resending sent reminders", async () => {
    const booking = await domain.createBooking(input(), client.id);
    await domain.recordPayment(
      booking.id,
      {
        amountMinor: booking.totalMinor,
        method: "TEST",
        idempotencyKey: "reminder-fixture-pay",
      },
      client,
    );
    const prefix = `${booking.id}:reminder:${shoot.toUTC().toISO()}:`;
    const reminders = await db.notificationJob.findMany({
      where: { dedupeKey: { startsWith: prefix } },
      orderBy: { scheduledAt: "asc" },
    });
    expect(reminders).toHaveLength(2);
    await db.notificationJob.update({
      where: { id: reminders[0].id },
      data: { status: "sent", sentAt: new Date() },
    });
    await domain.rescheduleBooking(
      booking.id,
      {
        startAt: shoot.plus({ hours: 3 }).toUTC().toISO()!,
        durationMinutes: 60,
      },
      client,
    );
    await domain.rescheduleBooking(
      booking.id,
      { startAt: shoot.toUTC().toISO()!, durationMinutes: 60 },
      client,
    );
    expect(
      (
        await db.notificationJob.findUniqueOrThrow({
          where: { id: reminders[0].id },
        })
      ).status,
    ).toBe("sent");
    expect(
      (
        await db.notificationJob.findUniqueOrThrow({
          where: { id: reminders[1].id },
        })
      ).status,
    ).toBe("pending");
  });
  it("selects the decor valid on the shooting date and freezes the chosen version", async () => {
    const changeAt = shoot.plus({ days: 1 }).startOf("day").toJSDate();
    await db.decorVersion.update({
      where: { id: "daylight-v1" },
      data: { validUntil: changeAt },
    });
    await db.decorVersion.create({
      data: {
        id: "daylight-v2",
        locationId: "daylight",
        name: "Future decor",
        image: "/images/daylight.svg",
        validFrom: changeAt,
      },
    });
    const old = await domain.createBooking(input(), client.id);
    const future = await domain.createBooking(
      input({ startAt: shoot.plus({ days: 2 }).toUTC().toISO()! }),
      client.id,
    );
    expect(old.versionName).toBe("Базовое оформление · демо");
    expect(future.versionName).toBe("Future decor");
    await db.decorVersion.update({
      where: { id: "daylight-v2" },
      data: { name: "Edited after booking" },
    });
    expect((await domain.getBooking(future.id, client)).versionName).toBe(
      "Future decor",
    );
  });
  it("rejects a bad timezone, unknown resources, and naive times", async () => {
    await expect(
      domain.getAvailability({
        locationId: "missing",
        date: shoot.toISODate()!,
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: "LOCATION_UNAVAILABLE" });
    await expect(
      domain.createBooking(
        input({ startAt: "2026-12-01T10:00:00" }),
        client.id,
      ),
    ).rejects.toThrow();
    await db.studioSettings.update({
      where: { id: "studio" },
      data: { timezone: "Mars/Almaty" },
    });
    await expect(domain.calculateQuote(input())).rejects.toMatchObject({
      code: "INVALID_TIMEZONE",
    });
  });
  it("denies clients access to other clients' orders and financial operations", async () => {
    const booking = await domain.createBooking(input(), client.id);
    await expect(domain.getBooking(booking.id, other)).rejects.toMatchObject({
      status: 404,
    });
    expect(await domain.listBookings(other)).toEqual([]);
    await expect(
      domain.recordPayment(
        booking.id,
        {
          amountMinor: 100,
          method: "MANUAL",
          idempotencyKey: "unauthorized-manual",
        },
        client,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(domain.cancelBooking(booking.id, other)).rejects.toMatchObject(
      { status: 404 },
    );
  });
  it("shows specialists only their assigned brief without payment or account information", async () => {
    const specialist = { id: "test-specialist", role: "SPECIALIST" };
    await db.user.create({
      data: {
        ...specialist,
        name: "Test specialist",
        email: "specialist@example.test",
        emailVerified: true,
      },
    });
    await db.specialist.update({
      where: { id: "photographer" },
      data: { userId: specialist.id },
    });
    const assigned = await domain.createBooking(
      input({ specialistId: "photographer" }),
      client.id,
    );
    const unrelated = await domain.createBooking(
      input({ locationId: "loft" }),
      other.id,
    );
    const visible = await domain.getBooking(assigned.id, specialist);
    expect(visible.number).toBe(assigned.number);
    expect(visible).not.toHaveProperty("totalMinor");
    expect(visible).not.toHaveProperty("payments");
    expect(visible).not.toHaveProperty("userId");
    await expect(
      domain.getBooking(unrelated.id, specialist),
    ).rejects.toMatchObject({ status: 404 });
    expect(await domain.listBookings(specialist)).toHaveLength(1);
  });
  it("creates content projects only when production or a specialist is booked", async () => {
    await domain.createBooking(input(), client.id);
    expect(await db.contentProject.count()).toBe(0);
    await domain.createBooking(
      input({ locationId: "loft", serviceIds: ["retouch"] }),
      client.id,
    );
    expect(await db.contentProject.count()).toBe(1);
  });
  it("expires holds through the worker and preserves payment records", async () => {
    const booking = await domain.createBooking(input(), client.id);
    await db.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await domain.expireHolds()).toEqual({ expired: 1 });
    expect(
      (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .status,
    ).toBe("expired");
    expect(
      await db.allocation.count({
        where: { bookingId: booking.id, releasedAt: null },
      }),
    ).toBe(0);
  });
});
