import { Prisma, type ResourceType } from "@prisma/client";
import { DateTime } from "luxon";
import { db } from "../db";
import { getSettings, type DbClient } from "../domain/catalog";
import { scheduleReminders } from "../domain/bookings";
import {
  resourceScheduleAllows,
  withinSchedule,
  localDay,
} from "../domain/time";
import { invariant, DomainError, type Actor } from "../domain/types";
import {
  activeAllocations,
  auditChange,
  checkRevision,
  plain,
  rejectConflicts,
  rejectEntityBookings,
  rejectResourceBookings,
  requireManager,
  writeStudio,
} from "./common";
import {
  closureSchema,
  decorSchema,
  equipmentSchema,
  exceptionSchema,
  locationSchema,
  roomSchema,
  scheduleSchema,
  serviceSchema,
  settingsSchema,
  specialistSchema,
  studioCommandSchema,
  unitSchema,
} from "./schemas";

export async function getAdminStudio(actor: Actor) {
  requireManager(actor);
  const [
    settings,
    rooms,
    locations,
    decorVersions,
    specialists,
    equipment,
    services,
    resources,
    recentAudit,
  ] = await Promise.all([
    getSettings(),
    db.room.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: { name: "asc" } }),
    db.decorVersion.findMany({
      orderBy: [{ locationId: "asc" }, { validFrom: "asc" }],
    }),
    db.specialist.findMany({ orderBy: { name: "asc" } }),
    db.equipment.findMany({
      include: { resource: { include: { units: true } } },
      orderBy: { name: "asc" },
    }),
    db.service.findMany({ orderBy: { name: "asc" } }),
    db.resource.findMany({
      include: {
        units: { orderBy: { serial: "asc" } },
        closures: { orderBy: { startAt: "asc" } },
        exceptions: { orderBy: { date: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    }),
  ]);
  return plain({
    settings,
    rooms,
    locations,
    decorVersions,
    specialists: specialists.map(({ userId: _userId, ...row }) => row),
    equipment: equipment.map(({ resource, ...row }) => ({
      ...row,
      quantity: resource.units.filter((unit) => !unit.retiredAt).length,
      availableQuantity: resource.units.filter(
        (unit) => !unit.retiredAt && unit.active,
      ).length,
    })),
    services,
    resources,
    recentAudit,
    paymentMode: process.env.PAYMENT_MODE === "test" ? "test" : "manual",
  });
}

async function createResource(
  client: DbClient,
  name: string,
  type: ResourceType,
  quantity = 1,
) {
  const settings = await getSettings(client);
  return client.resource.create({
    data: {
      name,
      type,
      openHour: settings.openHour,
      closeHour: settings.closeHour,
      units: {
        create: Array.from({ length: quantity }, (_, index) => ({
          serial: index + 1,
        })),
      },
    },
  });
}
async function requireResource(client: DbClient, id: string) {
  const resource = await client.resource.findUnique({
    where: { id },
    include: { exceptions: true },
  });
  invariant(resource, "NOT_FOUND", "Ресурс не найден.", 404);
  invariant(resource.active, "RESOURCE_ARCHIVED", "Ресурс архивирован.", 409);
  return resource;
}
function requireEditable(record: { archivedAt: Date | null } | null) {
  invariant(record, "NOT_FOUND", "Запись не найдена.", 404);
  invariant(
    !record.archivedAt,
    "ARCHIVED",
    "Архивная запись доступна только для просмотра.",
    409,
  );
}
async function ensureNoDecorOverlap(
  client: DbClient,
  value: {
    locationId: string;
    validFrom: string;
    validUntil: string | null;
    published: boolean;
  },
  id?: string,
) {
  if (!value.published) return;
  const overlap = await client.decorVersion.findFirst({
    where: {
      locationId: value.locationId,
      published: true,
      ...(id ? { id: { not: id } } : {}),
      ...(value.validUntil
        ? { validFrom: { lt: new Date(value.validUntil) } }
        : {}),
      OR: [
        { validUntil: null },
        { validUntil: { gt: new Date(value.validFrom) } },
      ],
    },
  });
  invariant(
    !overlap,
    "DECOR_OVERLAP",
    "Периоды опубликованных оформлений пересекаются. Сначала завершите предыдущий период.",
    409,
  );
}
async function resizeUnits(
  client: DbClient,
  resourceId: string,
  quantity: number,
) {
  const units = await client.resourceUnit.findMany({
    where: { resourceId },
    orderBy: { serial: "asc" },
  });
  const current = units.filter((unit) => !unit.retiredAt);
  if (quantity < current.length) {
    const retired = current.slice(quantity);
    rejectConflicts(
      (
        await activeAllocations(client, {
          unitId: { in: retired.map((unit) => unit.id) },
        })
      ).map((allocation) => allocation.booking),
      "Нельзя уменьшить количество: выбранные единицы оборудования уже зарезервированы.",
    );
    await client.resourceUnit.updateMany({
      where: { id: { in: retired.map((unit) => unit.id) } },
      data: {
        active: false,
        retiredAt: new Date(),
        revision: { increment: 1 },
      },
    });
  }
  if (quantity > current.length) {
    const needed = quantity - current.length;
    const maxSerial = Math.max(0, ...units.map((unit) => unit.serial));
    if (needed)
      await client.resourceUnit.createMany({
        data: Array.from({ length: needed }, (_, index) => ({
          resourceId,
          serial: maxSerial + index + 1,
        })),
      });
  }
}

export async function mutateStudio(raw: unknown, actor: Actor) {
  const command = studioCommandSchema.parse(raw);
  const { entity, operation, id, revision, ...parsedFields } = command;
  // Zod defaults belong to full create/update records, not omitted partial command fields.
  const fields = Object.fromEntries(
    Object.entries(parsedFields).filter(([key]) =>
      Object.hasOwn(raw as object, key),
    ),
  );
  if (operation === "create")
    invariant(
      !id && revision === undefined,
      "CREATE_FIELDS",
      "При создании не передавайте id или revision.",
    );
  if (operation !== "create")
    invariant(
      !!id || entity === "settings",
      "ID_REQUIRED",
      "Не указан идентификатор записи.",
    );
  const ownerOnly = !["schedule", "closure", "exception", "unit"].includes(
    entity,
  );
  return writeStudio(actor, ownerOnly, async (client) => {
    if (entity === "settings") {
      invariant(
        operation === "update",
        "OPERATION",
        "Настройки можно только изменять.",
      );
      const previous = await getSettings(client);
      checkRevision(previous, revision);
      const input = settingsSchema.parse({
        ...previous,
        contacts: previous.contacts,
        ...fields,
      });
      if (
        input.rulesText !== previous.rulesText &&
        input.rulesVersion === previous.rulesVersion
      )
        input.rulesVersion = `rules-${previous.revision + 1}`;
      if (
        ["timezone", "openHour", "closeHour"].some(
          (key) =>
            input[key as "timezone" | "openHour" | "closeHour"] !==
            previous[key as "timezone" | "openHour" | "closeHour"],
        )
      ) {
        const allocations = await activeAllocations(client);
        rejectConflicts(
          allocations
            .filter(
              (allocation) =>
                !withinSchedule(
                  allocation.booking.startAt,
                  allocation.booking.endAt,
                  input.timezone,
                  input.openHour,
                  input.closeHour,
                ) ||
                !resourceScheduleAllows(
                  allocation.startAt,
                  allocation.endAt,
                  input.timezone,
                  allocation.unit.resource,
                ),
            )
            .map((allocation) => allocation.booking),
        );
      }
      const result = await client.studioSettings.update({
        where: { id: "studio" },
        data: {
          ...input,
          contacts: input.contacts as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (
        JSON.stringify(input.reminderHours) !==
        JSON.stringify(previous.reminderHours)
      ) {
        for (const booking of await client.booking.findMany({
          where: { status: "confirmed", startAt: { gt: new Date() } },
        }))
          await scheduleReminders(client, booking);
      }
      await auditChange(
        client,
        actor,
        "StudioSettings",
        "studio",
        "updated",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "room") {
      if (operation === "create") {
        const input = roomSchema.parse(fields);
        const resource = await createResource(client, input.name, "ROOM");
        const result = await client.room.create({
          data: { ...input, resourceId: resource.id },
        });
        await auditChange(
          client,
          actor,
          "Room",
          result.id,
          "created",
          null,
          result,
        );
        return plain(result);
      }
      const previous = await client.room.findUnique({ where: { id } });
      checkRevision(previous, revision);
      requireEditable(previous);
      if (operation === "archive") {
        await rejectResourceBookings(client, previous!.resourceId);
        await client.resource.update({
          where: { id: previous!.resourceId },
          data: { active: false, revision: { increment: 1 } },
        });
        const result = await client.room.update({
          where: { id },
          data: { archivedAt: new Date(), revision: { increment: 1 } },
        });
        await auditChange(
          client,
          actor,
          "Room",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "update",
        "OPERATION",
        "Зал можно изменить или архивировать.",
      );
      const input = roomSchema.parse({ ...previous, ...fields });
      rejectConflicts(
        (
          await activeAllocations(client, {
            unit: { resourceId: previous!.resourceId },
          })
        )
          .filter((allocation) => allocation.booking.guests > input.capacity)
          .map((allocation) => allocation.booking),
      );
      invariant(
        (await client.location.count({
          where: {
            roomId: id,
            archivedAt: null,
            capacity: { gt: input.capacity },
          },
        })) === 0,
        "LOCATION_CAPACITY",
        "Сначала уменьшите вместимость связанных локаций.",
        409,
      );
      const result = await client.room.update({
        where: { id },
        data: { ...input, revision: { increment: 1 } },
      });
      await client.resource.update({
        where: { id: previous!.resourceId },
        data: { name: input.name, revision: { increment: 1 } },
      });
      await auditChange(
        client,
        actor,
        "Room",
        result.id,
        "updated",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "location") {
      const previous = id
        ? await client.location.findUnique({ where: { id } })
        : null;
      if (operation !== "create") {
        checkRevision(previous, revision);
        requireEditable(previous);
      }
      if (operation === "archive") {
        await rejectEntityBookings(client, { locationId: id });
        const result = await client.location.update({
          where: { id },
          data: {
            published: false,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        await auditChange(
          client,
          actor,
          "Location",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Локацию можно изменить или архивировать.",
      );
      const input = locationSchema.parse({ ...previous, ...fields });
      const room = await client.room.findUnique({
        where: { id: input.roomId },
      });
      requireEditable(room);
      invariant(
        input.capacity <= room!.capacity,
        "CAPACITY",
        "Вместимость локации превышает вместимость физического зала.",
      );
      if (previous && (input.roomId !== previous.roomId || !input.published))
        await rejectEntityBookings(client, { locationId: previous.id });
      if (previous)
        await rejectEntityBookings(client, {
          locationId: previous.id,
          guests: { gt: input.capacity },
        });
      const result = previous
        ? await client.location.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
          })
        : await client.location.create({ data: input });
      await auditChange(
        client,
        actor,
        "Location",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "decor") {
      const previous = id
        ? await client.decorVersion.findUnique({ where: { id } })
        : null;
      if (operation !== "create") {
        checkRevision(previous, revision);
        requireEditable(previous);
      }
      if (operation === "archive") {
        await rejectEntityBookings(client, { decorVersionId: id });
        const result = await client.decorVersion.update({
          where: { id },
          data: {
            published: false,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        await auditChange(
          client,
          actor,
          "DecorVersion",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Оформление можно изменить или архивировать.",
      );
      const input = decorSchema.parse({
        ...(previous
          ? {
              ...previous,
              validFrom: previous.validFrom.toISOString(),
              validUntil: previous.validUntil?.toISOString() ?? null,
            }
          : {}),
        ...fields,
      });
      requireEditable(
        await client.location.findUnique({ where: { id: input.locationId } }),
      );
      if (previous) {
        const materialChange =
          input.locationId !== previous.locationId ||
          input.name !== previous.name ||
          input.image !== previous.image ||
          !input.published;
        if (materialChange)
          await rejectEntityBookings(client, { decorVersionId: previous.id });
        else
          await rejectEntityBookings(client, {
            decorVersionId: previous.id,
            OR: [
              { startAt: { lt: new Date(input.validFrom) } },
              ...(input.validUntil
                ? [{ endAt: { gt: new Date(input.validUntil) } }]
                : []),
            ],
          });
      }
      await ensureNoDecorOverlap(client, input, id);
      const data = {
        ...input,
        validFrom: new Date(input.validFrom),
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
      };
      const result = previous
        ? await client.decorVersion.update({
            where: { id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await client.decorVersion.create({ data });
      await auditChange(
        client,
        actor,
        "DecorVersion",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "specialist") {
      const previous = id
        ? await client.specialist.findUnique({ where: { id } })
        : null;
      if (operation !== "create") {
        checkRevision(previous, revision);
        requireEditable(previous);
      }
      if (operation === "archive") {
        await rejectResourceBookings(client, previous!.resourceId);
        await client.resource.update({
          where: { id: previous!.resourceId },
          data: { active: false, revision: { increment: 1 } },
        });
        const result = await client.specialist.update({
          where: { id },
          data: {
            published: false,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        await auditChange(
          client,
          actor,
          "Specialist",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Специалиста можно изменить или архивировать.",
      );
      const input = specialistSchema.parse({ ...previous, ...fields });
      if (previous && !input.published)
        await rejectResourceBookings(client, previous.resourceId);
      const resource = previous
        ? await client.resource.update({
            where: { id: previous.resourceId },
            data: { name: input.name, revision: { increment: 1 } },
          })
        : await createResource(client, input.name, "SPECIALIST");
      const result = previous
        ? await client.specialist.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
          })
        : await client.specialist.create({
            data: { ...input, resourceId: resource.id },
          });
      await auditChange(
        client,
        actor,
        "Specialist",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "equipment") {
      const previous = id
        ? await client.equipment.findUnique({
            where: { id },
            include: { resource: { include: { units: true } } },
          })
        : null;
      if (operation !== "create") {
        checkRevision(previous, revision);
        requireEditable(previous);
      }
      if (operation === "archive") {
        await rejectResourceBookings(client, previous!.resourceId);
        await client.resource.update({
          where: { id: previous!.resourceId },
          data: { active: false, revision: { increment: 1 } },
        });
        const result = await client.equipment.update({
          where: { id },
          data: {
            published: false,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        await auditChange(
          client,
          actor,
          "Equipment",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Оборудование можно изменить или архивировать.",
      );
      const { quantity, ...input } = equipmentSchema.parse({
        ...previous,
        quantity: previous?.resource.units.filter((unit) => !unit.retiredAt)
          .length,
        ...fields,
      });
      if (previous && !input.published)
        await rejectResourceBookings(client, previous.resourceId);
      const resource = previous
        ? await client.resource.update({
            where: { id: previous.resourceId },
            data: { name: input.name, revision: { increment: 1 } },
          })
        : await createResource(client, input.name, "EQUIPMENT", quantity);
      if (previous) await resizeUnits(client, previous.resourceId, quantity);
      const result = previous
        ? await client.equipment.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
          })
        : await client.equipment.create({
            data: { ...input, resourceId: resource.id },
          });
      await auditChange(
        client,
        actor,
        "Equipment",
        result.id,
        previous ? "updated" : "created",
        previous,
        { ...result, quantity },
      );
      return plain({ ...result, quantity });
    }
    if (entity === "service") {
      const previous = id
        ? await client.service.findUnique({ where: { id } })
        : null;
      if (operation !== "create") {
        checkRevision(previous, revision);
        requireEditable(previous);
      }
      if (operation === "archive") {
        const bookings = await client.booking.findMany({
          where: {
            allocations: {
              some: {
                releasedAt: null,
                endAt: { gt: new Date() },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          },
        });
        rejectConflicts(
          bookings.filter((booking) =>
            (
              booking.inputSnapshot as { serviceIds?: string[] }
            ).serviceIds?.includes(id!),
          ),
        );
        const result = await client.service.update({
          where: { id },
          data: {
            published: false,
            archivedAt: new Date(),
            revision: { increment: 1 },
          },
        });
        await auditChange(
          client,
          actor,
          "Service",
          result.id,
          "archived",
          previous,
          result,
        );
        return plain(result);
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Услугу можно изменить или архивировать.",
      );
      const input = serviceSchema.parse({ ...previous, ...fields });
      const result = previous
        ? await client.service.update({
            where: { id },
            data: { ...input, revision: { increment: 1 } },
          })
        : await client.service.create({ data: input });
      await auditChange(
        client,
        actor,
        "Service",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "schedule") {
      invariant(
        operation === "update",
        "OPERATION",
        "Расписание можно только изменять.",
      );
      const previous = await requireResource(client, id!);
      checkRevision(previous, revision);
      const input = scheduleSchema.parse({ ...previous, ...fields });
      const settings = await getSettings(client);
      rejectConflicts(
        (await activeAllocations(client, { unit: { resourceId: id } }))
          .filter(
            (allocation) =>
              !resourceScheduleAllows(
                allocation.startAt,
                allocation.endAt,
                settings.timezone,
                { ...previous, ...input },
              ),
          )
          .map((allocation) => allocation.booking),
      );
      const result = await client.resource.update({
        where: { id },
        data: { ...input, revision: { increment: 1 } },
      });
      await auditChange(
        client,
        actor,
        "Resource",
        result.id,
        "schedule_updated",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "closure") {
      const previous = id
        ? await client.resourceClosure.findUnique({ where: { id } })
        : null;
      if (operation !== "create") checkRevision(previous, revision);
      if (operation === "delete") {
        const result = await client.resourceClosure.delete({ where: { id } });
        await auditChange(
          client,
          actor,
          "ResourceClosure",
          result.id,
          "deleted",
          previous,
          null,
        );
        return { id, deleted: true };
      }
      invariant(
        operation === "create" || operation === "update",
        "OPERATION",
        "Закрытие можно изменить или удалить.",
      );
      const input = closureSchema.parse({
        ...(previous
          ? {
              ...previous,
              startAt: previous.startAt.toISOString(),
              endAt: previous.endAt.toISOString(),
            }
          : {}),
        ...fields,
      });
      await requireResource(client, input.resourceId);
      rejectConflicts(
        (
          await activeAllocations(client, {
            unit: { resourceId: input.resourceId },
            startAt: { lt: new Date(input.endAt) },
            endAt: { gt: new Date(input.startAt) },
          })
        ).map((allocation) => allocation.booking),
      );
      const data = {
        ...input,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
      };
      const result = previous
        ? await client.resourceClosure.update({
            where: { id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await client.resourceClosure.create({ data });
      await auditChange(
        client,
        actor,
        "ResourceClosure",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    if (entity === "exception") {
      const previous = id
        ? await client.resourceScheduleException.findUnique({ where: { id } })
        : null;
      if (operation !== "create") checkRevision(previous, revision);
      invariant(
        operation === "create" ||
          operation === "update" ||
          operation === "delete",
        "OPERATION",
        "Исключение можно изменить или удалить.",
      );
      const input =
        operation === "delete"
          ? previous!
          : exceptionSchema.parse({ ...previous, ...fields });
      invariant(
        !previous || input.resourceId === previous.resourceId,
        "EXCEPTION_RESOURCE",
        "Ресурс исключения менять нельзя. Создайте отдельное исключение для другого ресурса.",
      );
      const resource = await requireResource(client, input.resourceId);
      const settings = await getSettings(client);
      localDay(input.date, settings.timezone);
      const nextException = {
        ...input,
        openHour: input.closed ? null : (input.openHour ?? null),
        closeHour: input.closed ? null : (input.closeHour ?? null),
      };
      const next = resource.exceptions.filter(
        (exception) => exception.id !== id,
      );
      if (operation !== "delete")
        next.push({
          ...nextException,
          id: id ?? "new",
          revision: (revision ?? 0) + 1,
        });
      rejectConflicts(
        (
          await activeAllocations(client, {
            unit: { resourceId: input.resourceId },
          })
        )
          .filter(
            (allocation) =>
              !resourceScheduleAllows(
                allocation.startAt,
                allocation.endAt,
                settings.timezone,
                { ...resource, exceptions: next },
              ),
          )
          .map((allocation) => allocation.booking),
      );
      if (operation === "delete") {
        await client.resourceScheduleException.delete({ where: { id } });
        await auditChange(
          client,
          actor,
          "ResourceScheduleException",
          id!,
          "deleted",
          previous,
          null,
        );
        return { id, deleted: true };
      }
      const { resourceId, date, closed, openHour, closeHour } = nextException;
      const data = { resourceId, date, closed, openHour, closeHour };
      const result = previous
        ? await client.resourceScheduleException.update({
            where: { id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await client.resourceScheduleException.create({ data });
      await auditChange(
        client,
        actor,
        "ResourceScheduleException",
        result.id,
        previous ? "updated" : "created",
        previous,
        result,
      );
      return plain(result);
    }
    invariant(
      entity === "unit" && operation === "update",
      "OPERATION",
      "Состояние единицы оборудования можно только изменять.",
    );
    const previous = await client.resourceUnit.findUnique({
      where: { id },
      include: { resource: true },
    });
    checkRevision(previous, revision);
    invariant(
      previous?.resource.type === "EQUIPMENT" &&
        !previous.retiredAt &&
        previous.resource.active,
      "UNIT_UNAVAILABLE",
      "Единица оборудования недоступна.",
      409,
    );
    const input = unitSchema.parse({ ...previous, ...fields });
    if (!input.active)
      rejectConflicts(
        (await activeAllocations(client, { unitId: id })).map(
          (allocation) => allocation.booking,
        ),
      );
    const result = await client.resourceUnit.update({
      where: { id },
      data: { ...input, revision: { increment: 1 } },
    });
    await auditChange(
      client,
      actor,
      "ResourceUnit",
      result.id,
      "updated",
      previous,
      result,
    );
    return plain(result);
  });
}
