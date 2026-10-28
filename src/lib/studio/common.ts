import { Prisma } from "@prisma/client";
import { db } from "../db";
import { lockStudio } from "../domain/locks";
import { DomainError, invariant, isStaff, type Actor } from "../domain/types";
import type { DbClient } from "../domain/catalog";

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function requireManager(actor: Actor, ownerOnly = false) {
  invariant(
    ownerOnly ? actor.role === "OWNER" : isStaff(actor),
    "FORBIDDEN",
    ownerOnly
      ? "Это действие доступно владельцу студии."
      : "Недостаточно прав.",
    403,
  );
}
export function checkRevision(
  previous: { revision: number } | null,
  revision: number | undefined,
) {
  invariant(previous, "NOT_FOUND", "Запись не найдена.", 404);
  if (revision !== previous.revision)
    throw new DomainError(
      "REVISION_CONFLICT",
      "Запись уже изменена. Обновите данные перед сохранением.",
      409,
      { currentRevision: previous.revision },
    );
}
export async function writeStudio<T>(
  actor: Actor,
  ownerOnly: boolean,
  fn: (client: DbClient) => Promise<T>,
) {
  requireManager(actor, ownerOnly);
  try {
    return await db.$transaction(
      async (client) => {
        await lockStudio(client, "exclusive");
        return fn(client);
      },
      { maxWait: 20_000, timeout: 30_000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new DomainError(
        "DUPLICATE",
        "Запись с таким значением уже существует.",
        409,
      );
    throw error;
  }
}
export async function auditChange(
  client: DbClient,
  actor: Actor,
  entityType: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await client.auditEvent.create({
    data: {
      actorId: actor.id,
      entityType,
      entityId,
      action: `${entityType.toLowerCase()}.${action}`,
      metadata: {
        before: plain(before ?? null),
        after: plain(after ?? null),
      } as Prisma.InputJsonValue,
    },
  });
}
export const activeAllocationWhere = (
  now = new Date(),
): Prisma.AllocationWhereInput => ({
  releasedAt: null,
  endAt: { gt: now },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});
export async function activeAllocations(
  client: DbClient,
  filter: Prisma.AllocationWhereInput = {},
) {
  return client.allocation.findMany({
    where: { AND: [activeAllocationWhere(), filter] },
    include: {
      booking: true,
      unit: { include: { resource: { include: { exceptions: true } } } },
    },
  });
}
export type ConflictBooking = {
  id: string;
  number: string;
  startAt: Date;
  endAt: Date;
  locationName: string;
};
export function rejectConflicts(
  bookings: ConflictBooking[],
  message = "Изменение затрагивает действующие бронирования. Сначала перенесите или урегулируйте эти заказы.",
) {
  if (!bookings.length) return;
  const unique = [
    ...new Map(bookings.map((booking) => [booking.id, booking])).values(),
  ];
  throw new DomainError("BOOKING_CONFLICT", message, 409, {
    conflicts: unique.map(({ id, number, startAt, endAt, locationName }) => ({
      id,
      number,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      locationName,
    })),
  });
}
export async function rejectResourceBookings(
  client: DbClient,
  resourceId: string,
) {
  rejectConflicts(
    (await activeAllocations(client, { unit: { resourceId } })).map(
      (allocation) => allocation.booking,
    ),
  );
}
export async function rejectEntityBookings(
  client: DbClient,
  filter: Prisma.BookingWhereInput,
) {
  rejectConflicts(
    await client.booking.findMany({
      where: {
        AND: [filter, { allocations: { some: activeAllocationWhere() } }],
      },
    }),
  );
}
