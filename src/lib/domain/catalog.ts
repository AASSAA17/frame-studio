import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { db } from "../db";
import { hourlyLine, summarizePrice } from "./pricing";
import {
  quoteInputSchema,
  invariant,
  type QuoteInput,
  type QuoteItem,
} from "./types";
import { checkTimezone, withinSchedule } from "./time";

export type DbClient = Prisma.TransactionClient;
export type ResourceNeed = {
  resourceId: string;
  count: number;
  startAt: Date;
  endAt: Date;
};

export async function getSettings(client: DbClient = db) {
  const settings = await client.studioSettings.findUnique({
    where: { id: "studio" },
  });
  invariant(
    settings,
    "NOT_CONFIGURED",
    "Студия ещё не настроена. Выполните загрузку демонстрационных данных.",
    503,
  );
  checkTimezone(settings.timezone);
  return settings;
}

export async function getCatalog() {
  const settings = await getSettings();
  const now = new Date();
  const [locations, specialists, services, equipment] = await Promise.all([
    db.location.findMany({
      where: {
        published: true,
        archivedAt: null,
        room: { archivedAt: null, resource: { active: true } },
      },
      orderBy: { name: "asc" },
      include: {
        versions: {
          where: {
            published: true,
            archivedAt: null,
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          orderBy: { validFrom: "desc" },
        },
      },
    }),
    db.specialist.findMany({
      where: { published: true, archivedAt: null, resource: { active: true } },
      orderBy: { name: "asc" },
    }),
    db.service.findMany({
      where: { published: true, archivedAt: null },
      orderBy: { name: "asc" },
    }),
    db.equipment.findMany({
      where: { published: true, archivedAt: null, resource: { active: true } },
      include: {
        resource: {
          include: { units: { where: { active: true, retiredAt: null } } },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    settings: {
      name: settings.name,
      city: settings.city,
      currency: settings.currency,
      timezone: settings.timezone,
      depositPercent: settings.depositPercent,
      holdMinutes: settings.holdMinutes,
      openHour: settings.openHour,
      closeHour: settings.closeHour,
      stepMinutes: settings.stepMinutes,
      minimumMinutes: settings.minimumMinutes,
      rulesText: settings.rulesText,
      rulesVersion: settings.rulesVersion,
      contacts: settings.contacts,
      bufferBeforeMinutes: settings.bufferBeforeMinutes,
      bufferAfterMinutes: settings.bufferAfterMinutes,
    },
    locations: locations.map(
      ({
        versions,
        archivedAt: _archivedAt,
        revision: _revision,
        ...location
      }) => {
        const current = versions.find(
          (version) =>
            version.validFrom <= now &&
            (!version.validUntil || version.validUntil > now),
        );
        return {
          ...location,
          versionName: current?.name ?? "Оформление уточняется",
          currentVersion: current
            ? {
                id: current.id,
                name: current.name,
                image: current.image,
                validFrom: current.validFrom.toISOString(),
                validUntil: current.validUntil?.toISOString() ?? null,
              }
            : null,
          futureVersions: versions
            .filter((version) => version.validFrom > now)
            .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())
            .map((version) => ({
              id: version.id,
              name: version.name,
              image: version.image,
              validFrom: version.validFrom.toISOString(),
              validUntil: version.validUntil?.toISOString() ?? null,
            })),
        };
      },
    ),
    specialists: specialists.map(
      ({ id, name, specialty, hourlyPriceMinor }) => ({
        id,
        name,
        specialty,
        hourlyPriceMinor,
      }),
    ),
    services: services.map(({ id, name, description, priceMinor }) => ({
      id,
      name,
      description,
      priceMinor,
    })),
    equipment: equipment
      .filter((item) => item.resource.units.length > 0)
      .map(({ resource, ...item }) => ({
        id: item.id,
        name: item.name,
        priceMinor: item.priceMinor,
        quantity: resource.units.length,
      })),
  };
}

export async function prepareQuote(
  raw: QuoteInput,
  client: DbClient = db,
  options: { allowPast?: boolean } = {},
) {
  const input = quoteInputSchema.parse(raw);
  const settings = await getSettings(client);
  const startAt = new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
  invariant(
    options.allowPast || startAt.getTime() > Date.now(),
    "PAST_TIME",
    "Выберите время в будущем.",
  );
  const localStart = DateTime.fromJSDate(startAt, { zone: settings.timezone });
  invariant(
    input.durationMinutes >= settings.minimumMinutes &&
      input.durationMinutes % settings.stepMinutes === 0,
    "INVALID_DURATION",
    `Минимальная длительность — ${settings.minimumMinutes} мин., шаг — ${settings.stepMinutes} мин.`,
  );
  invariant(
    (localStart.hour * 60 + localStart.minute) % settings.stepMinutes === 0 &&
      localStart.second === 0 &&
      localStart.millisecond === 0,
    "INVALID_STEP",
    `Начало записи должно соответствовать шагу ${settings.stepMinutes} минут.`,
  );
  invariant(
    withinSchedule(
      startAt,
      endAt,
      settings.timezone,
      settings.openHour,
      settings.closeHour,
    ),
    "OUTSIDE_HOURS",
    "Выбранное время за пределами рабочих часов студии.",
  );

  const location = await client.location.findUnique({
    where: { id: input.locationId },
    include: { room: { include: { resource: true } } },
  });
  invariant(
    location?.published &&
      !location.archivedAt &&
      !location.room.archivedAt &&
      location.room.resource.active,
    "LOCATION_UNAVAILABLE",
    "Локация недоступна.",
    404,
  );
  invariant(
    input.guests <= Math.min(location.capacity, location.room.capacity),
    "CAPACITY",
    "Число участников превышает вместимость зала.",
  );
  const version = await client.decorVersion.findFirst({
    where: {
      locationId: location.id,
      published: true,
      archivedAt: null,
      validFrom: { lte: startAt },
      OR: [{ validUntil: null }, { validUntil: { gte: endAt } }],
    },
    orderBy: { validFrom: "desc" },
  });
  invariant(
    version,
    "DECOR_UNAVAILABLE",
    "На это время нет опубликованного оформления.",
    409,
  );
  const specialist = input.specialistId
    ? await client.specialist.findUnique({
        where: { id: input.specialistId },
        include: { resource: true },
      })
    : null;
  invariant(
    !input.specialistId ||
      (specialist?.published &&
        !specialist.archivedAt &&
        specialist.resource.active),
    "SPECIALIST_UNAVAILABLE",
    "Специалист недоступен.",
    409,
  );
  const serviceIds = [...new Set(input.serviceIds)];
  const services = await client.service.findMany({
    where: { id: { in: serviceIds }, published: true, archivedAt: null },
    orderBy: { id: "asc" },
  });
  invariant(
    services.length === serviceIds.length,
    "SERVICE_UNAVAILABLE",
    "Одна из услуг недоступна.",
    409,
  );
  const equipmentCounts = input.equipmentIds.reduce<Record<string, number>>(
    (counts, id) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }),
    {},
  );
  const equipment = await client.equipment.findMany({
    where: {
      id: { in: Object.keys(equipmentCounts) },
      published: true,
      archivedAt: null,
      resource: { active: true },
    },
    include: { resource: true },
    orderBy: { id: "asc" },
  });
  invariant(
    equipment.length === Object.keys(equipmentCounts).length,
    "EQUIPMENT_UNAVAILABLE",
    "Оборудование недоступно.",
    409,
  );

  const items: QuoteItem[] = [
    hourlyLine(
      `Аренда ${location.name}`,
      location.hourlyPriceMinor,
      input.durationMinutes,
    ),
  ];
  if (specialist)
    items.push(
      hourlyLine(
        `Специалист: ${specialist.name}`,
        specialist.hourlyPriceMinor,
        input.durationMinutes,
      ),
    );
  for (const service of services)
    items.push({
      label: service.name,
      quantity: 1,
      unitPriceMinor: service.priceMinor,
      totalMinor: service.priceMinor,
    });
  for (const item of equipment)
    items.push({
      label: item.name,
      quantity: equipmentCounts[item.id],
      unitPriceMinor: item.priceMinor,
      totalMinor: item.priceMinor * equipmentCounts[item.id],
    });
  const needs: ResourceNeed[] = [
    {
      resourceId: location.room.resourceId,
      count: 1,
      startAt: new Date(
        startAt.getTime() - settings.bufferBeforeMinutes * 60_000,
      ),
      endAt: new Date(endAt.getTime() + settings.bufferAfterMinutes * 60_000),
    },
  ];
  if (specialist)
    needs.push({ resourceId: specialist.resourceId, count: 1, startAt, endAt });
  for (const item of equipment)
    needs.push({
      resourceId: item.resourceId,
      count: equipmentCounts[item.id],
      startAt,
      endAt,
    });
  const price = summarizePrice(items, settings.depositPercent);
  invariant(
    price.totalMinor > 0 && price.depositMinor > 0,
    "NONPOSITIVE_PRICE",
    "Стоимость и предоплата должны быть больше нуля. Уточните тариф студии.",
  );
  const quote = {
    items,
    ...price,
    currency: settings.currency,
    version: { id: version.id, name: version.name, image: version.image },
    rulesVersion: settings.rulesVersion,
    rulesText: settings.rulesText,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(quote))
    .digest("hex");
  return {
    input,
    settings,
    startAt,
    endAt,
    location,
    version,
    specialist,
    services,
    equipment,
    needs,
    quote: { ...quote, fingerprint },
  };
}

export async function calculateQuote(input: QuoteInput) {
  const prepared = await prepareQuote(input);
  return prepared.quote;
}
