import { Prisma } from "@prisma/client";
import { db } from "../db";
import {
  getSettings,
  prepareQuote,
  type DbClient,
  type ResourceNeed,
} from "./catalog";
import { DomainError, invariant, type AvailabilityInput } from "./types";
import { localDay, withinSchedule } from "./time";

export async function lockResources(client: DbClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return;
  await client.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Resource" WHERE "id" IN (${Prisma.join(sorted)}) ORDER BY "id" FOR UPDATE`,
  );
}

export async function availableUnits(
  client: DbClient,
  needs: ResourceNeed[],
  zone: string,
  now = new Date(),
  excludeBookingId?: string,
) {
  const result: { unitId: string; startAt: Date; endAt: Date }[] = [];
  for (const need of needs) {
    const resource = await client.resource.findUnique({
      where: { id: need.resourceId },
      include: {
        closures: {
          where: { startAt: { lt: need.endAt }, endAt: { gt: need.startAt } },
        },
        units: {
          where: { active: true },
          orderBy: { serial: "asc" },
          include: {
            allocations: {
              where: {
                releasedAt: null,
                startAt: { lt: need.endAt },
                endAt: { gt: need.startAt },
                ...(excludeBookingId
                  ? { bookingId: { not: excludeBookingId } }
                  : {}),
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            },
          },
        },
      },
    });
    invariant(
      resource?.active &&
        resource.closures.length === 0 &&
        withinSchedule(
          need.startAt,
          need.endAt,
          zone,
          resource.openHour,
          resource.closeHour,
          resource.weekdays,
        ),
      "RESOURCE_UNAVAILABLE",
      "Выбранный зал, специалист или оборудование недоступны в это время.",
      409,
    );
    const free = resource.units.filter((unit) => unit.allocations.length === 0);
    invariant(
      free.length >= need.count,
      "TIME_CONFLICT",
      "Это время уже занято. Обновите доступные интервалы и выберите другой.",
      409,
    );
    result.push(
      ...free
        .slice(0, need.count)
        .map((unit) => ({
          unitId: unit.id,
          startAt: need.startAt,
          endAt: need.endAt,
        })),
    );
  }
  return result;
}

export async function reserveResources(
  client: DbClient,
  needs: ResourceNeed[],
  zone: string,
  bookingId: string,
  expiresAt: Date | null,
  now = new Date(),
) {
  // Caller holds all relevant Resource row locks. Release stale rows before the DB exclusion constraint is checked.
  await client.allocation.updateMany({
    where: {
      releasedAt: null,
      expiresAt: { lte: now },
      unit: { resourceId: { in: needs.map((need) => need.resourceId) } },
    },
    data: { releasedAt: now },
  });
  const units = await availableUnits(client, needs, zone, now, bookingId);
  await client.allocation.createMany({
    data: units.map((unit) => ({ ...unit, bookingId, expiresAt })),
  });
}

export async function getAvailability(input: AvailabilityInput) {
  const settings = await getSettings();
  const day = localDay(input.date, settings.timezone);
  invariant(
    Number.isInteger(input.durationMinutes) &&
      input.durationMinutes >= settings.minimumMinutes &&
      input.durationMinutes <= 720 &&
      input.durationMinutes % settings.stepMinutes === 0,
    "INVALID_DURATION",
    "Некорректная длительность бронирования.",
  );
  invariant(
    typeof input.locationId === "string" && input.locationId.length <= 100,
    "INVALID_LOCATION",
    "Укажите локацию.",
  );
  const location = await db.location.findUnique({
    where: { id: input.locationId },
    select: { published: true },
  });
  invariant(
    location?.published,
    "LOCATION_UNAVAILABLE",
    "Локация недоступна.",
    404,
  );
  if (input.specialistId) {
    const specialist = await db.specialist.findUnique({
      where: { id: input.specialistId },
      select: { published: true },
    });
    invariant(
      specialist?.published,
      "SPECIALIST_UNAVAILABLE",
      "Специалист недоступен.",
      404,
    );
  }
  invariant(
    !input.equipmentIds ||
      (Array.isArray(input.equipmentIds) &&
        input.equipmentIds.length <= 20 &&
        input.equipmentIds.every(
          (id) => typeof id === "string" && id.length > 0 && id.length <= 100,
        )),
    "INVALID_EQUIPMENT",
    "Некорректный список оборудования.",
  );
  const equipmentIds = [...new Set(input.equipmentIds ?? [])];
  if (equipmentIds.length)
    invariant(
      (await db.equipment.count({
        where: { id: { in: equipmentIds }, published: true },
      })) === equipmentIds.length,
      "EQUIPMENT_UNAVAILABLE",
      "Оборудование недоступно.",
      404,
    );
  const closeHour =
    settings.closeHour <= settings.openHour
      ? settings.closeHour + 24
      : settings.closeHour;
  const slots: {
    startAt: string;
    endAt: string;
    label: string;
    available: boolean;
  }[] = [];
  const now = new Date();
  for (
    let minute = settings.openHour * 60;
    minute + input.durationMinutes <= closeHour * 60;
    minute += settings.stepMinutes
  ) {
    const start = day.plus({ minutes: minute });
    const end = start.plus({ minutes: input.durationMinutes });
    let available = start.toMillis() > now.getTime();
    if (available) {
      try {
        const prepared = await prepareQuote({
          locationId: input.locationId,
          startAt: start.toUTC().toISO()!,
          durationMinutes: input.durationMinutes,
          specialistId: input.specialistId,
          equipmentIds: input.equipmentIds ?? [],
          serviceIds: [],
          guests: 1,
          purpose: "photo",
        });
        await availableUnits(db, prepared.needs, settings.timezone, now);
      } catch (error) {
        if (!(error instanceof DomainError) || error.status >= 500) throw error;
        available = false;
      }
    }
    slots.push({
      startAt: start.toUTC().toISO()!,
      endAt: end.toUTC().toISO()!,
      label: start.toFormat("HH:mm"),
      available,
    });
  }
  return { slots, timezone: settings.timezone };
}
