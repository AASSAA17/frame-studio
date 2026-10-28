import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

// This test creates its own empty database and removes only that database.
// It exercises the actual SQL upgrade from stage 1, without touching app data.
const source = process.env.TEST_DATABASE_URL;
if (!source)
  throw new Error("Set TEST_DATABASE_URL to a local disposable test database.");
const parsed = new URL(source);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test")
) {
  throw new Error(
    "Migration verification requires a local TEST_DATABASE_URL ending in _test.",
  );
}
const databaseName = `frame_migration_${randomBytes(8).toString("hex")}_test`;
const controlUrl = new URL(source);
controlUrl.pathname = "/postgres";
const targetUrl = new URL(source);
targetUrl.pathname = `/${databaseName}`;
const control = new PrismaClient({ datasourceUrl: controlUrl.toString() });
const target = new PrismaClient({ datasourceUrl: targetUrl.toString() });
const defaultWindowsBin = "C:/Program Files/PostgreSQL/18/bin";
const postgresBin =
  process.env.POSTGRES_BIN ??
  (process.platform === "win32" && existsSync(defaultWindowsBin)
    ? defaultWindowsBin
    : undefined);
const executable = postgresBin
  ? join(postgresBin, process.platform === "win32" ? "psql.exe" : "psql")
  : "psql";
function sql(sourceText: string) {
  const result = spawnSync(
    executable,
    ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1"],
    {
      input: sourceText,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || "5432",
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: databaseName,
        PGOPTIONS: "-c timezone=UTC",
      },
    },
  );
  if (result.status !== 0)
    throw new Error(
      `Migration SQL failed (${result.error?.name ?? result.status}); no connection credentials were logged.`,
    );
}
const migrations = [
  "202610250001_initial",
  "202610250002_reminder_settings",
  "202610250003_timestamp_instants",
  "202610250004_studio_management",
];
const readMigration = (name: string) =>
  readFileSync(resolve("prisma/migrations", name, "migration.sql"), "utf8");
async function snapshot() {
  const values = await target.$queryRaw<{ value: unknown }[]>`
    SELECT jsonb_build_object(
      'booking', (SELECT to_jsonb(b) - ARRAY['customerId','createdById','creationKey','creationPayloadHash','source'] FROM "Booking" b WHERE id='migration-booking'),
      'items', (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "BookingItem" i),
      'payments', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM "Payment" p),
      'allocations', (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM "Allocation" a),
      'outbox', (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM "NotificationJob" n)
    ) AS value`;
  return JSON.stringify(values[0].value);
}
async function main() {
  let created = false;
  try {
    await control.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    for (const migration of migrations.slice(0, 3))
      sql(readMigration(migration));
    sql(`
    INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ('migration-user','Migration fixture','migration@example.test',true,NOW());
    INSERT INTO "Resource" (id,name,type) VALUES ('migration-resource','Migration room','ROOM');
    INSERT INTO "ResourceUnit" (id,"resourceId",serial) VALUES ('migration-unit','migration-resource',1);
    INSERT INTO "Room" (id,name,"resourceId",capacity) VALUES ('migration-room','Migration room','migration-resource',5);
    INSERT INTO "Location" (id,slug,name,description,image,area,capacity,"hourlyPriceMinor","roomId") VALUES ('migration-location','migration-location','Migration location','Fixture','/images/daylight.svg',30,5,100000,'migration-room');
    INSERT INTO "DecorVersion" (id,"locationId",name,image,"validFrom") VALUES ('migration-decor','migration-location','Saved decor','/images/daylight.svg','2026-01-01T00:00:00Z');
    INSERT INTO "Booking" (id,number,"userId","locationId","decorVersionId",status,name,phone,purpose,guests,"startAt","endAt","totalMinor","depositMinor","locationName","versionName","rulesVersion","rulesText","inputSnapshot","versionSnapshot","updatedAt")
    VALUES ('migration-booking','MIGRATION-001','migration-user','migration-location','migration-decor','confirmed','Migration fixture','+70000000000','photo',2,'2026-11-10T05:00:00Z','2026-11-10T06:00:00Z',100000,30000,'Saved location','Saved decor','saved-1','Saved accepted rules','{"timezone":"Asia/Almaty","resourceNeeds":[{"resourceId":"migration-resource","count":1,"startAt":"2026-11-10T04:45:00Z","endAt":"2026-11-10T06:15:00Z"}]}','{"id":"migration-decor","name":"Saved decor"}',NOW());
    INSERT INTO "BookingItem" (id,"bookingId",label,quantity,"unitPriceMinor","totalMinor") VALUES ('migration-item','migration-booking','Saved hourly rate',1,100000,100000);
    INSERT INTO "Allocation" (id,"unitId","bookingId","startAt","endAt") VALUES ('migration-allocation','migration-unit','migration-booking','2026-11-10T04:45:00Z','2026-11-10T06:15:00Z');
    INSERT INTO "Payment" (id,"bookingId",kind,"amountMinor",currency,method,"idempotencyKey","actorId") VALUES ('migration-payment','migration-booking','CHARGE',30000,'KZT','TEST','migration-payment-key','migration-user');
    INSERT INTO "NotificationJob" (id,"bookingId","dedupeKey","to",subject,text,"scheduledAt","lockedUntil") VALUES ('migration-job','migration-booking','migration-reminder','migration@example.test','Fixture','Fixture','2026-11-09T05:00:00Z','2026-11-09T05:02:00Z');
  `);
    const before = await snapshot();
    sql(readMigration(migrations[3]));
    const after = await snapshot();
    assert.equal(
      after,
      before,
      "Existing orders, money, allocations and queued job timestamps must be unchanged",
    );
    const booking = await target.booking.findUniqueOrThrow({
      where: { id: "migration-booking" },
      include: { customer: true },
    });
    assert.equal(booking.customer?.userId, "migration-user");
    assert.equal(booking.customerId, "account-migration-user");
    assert.equal(booking.userId, "migration-user");
    assert.equal(booking.createdById, "migration-user");
    console.log(
      JSON.stringify({
        result: "passed",
        migrations: migrations.length,
        preserved: ["booking", "items", "payments", "allocations", "outbox"],
        customerIdentity: "preserved",
        snapshotSha256: createHash("sha256").update(after).digest("hex"),
      }),
    );
  } finally {
    await target.$disconnect();
    if (created)
      await control.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    await control.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Migration verification failed; no connection details logged.",
  );
  process.exitCode = 1;
});
