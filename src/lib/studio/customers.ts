import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { bookingDto, bookingInclude } from "../domain/bookings";
import { paymentSummary } from "../domain/pricing";
import { invariant, type Actor } from "../domain/types";
import { customerSchema } from "./schemas";
import {
  auditChange,
  checkRevision,
  plain,
  requireManager,
  writeStudio,
} from "./common";

export const normalizePhone = (phone: string | null | undefined) =>
  phone?.replace(/\D/g, "") || null;
const customerInclude = Prisma.validator<Prisma.CustomerInclude>()({
  bookings: { include: { payments: true } },
});
type CustomerRecord = Prisma.CustomerGetPayload<{
  include: typeof customerInclude;
}>;
function customerDto(customer: CustomerRecord) {
  const { bookings, normalizedPhone: _normalizedPhone, ...record } = customer;
  return {
    ...plain(record),
    bookingCount: bookings.length,
    paidMinor: bookings.reduce(
      (sum, booking) =>
        sum + paymentSummary(booking.payments, booking.totalMinor).paidMinor,
      0,
    ),
  };
}
export async function listCustomers(query: string, actor: Actor) {
  requireManager(actor);
  const search = z.string().trim().max(200).parse(query);
  const customers = await db.customer.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { tags: { has: search } },
          ],
        }
      : {},
    include: customerInclude,
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    take: 1000,
  });
  return customers.map(customerDto);
}
export async function getCustomer(id: string, actor: Actor) {
  requireManager(actor);
  const customer = await db.customer.findUnique({
    where: { id },
    include: customerInclude,
  });
  invariant(customer, "NOT_FOUND", "Клиент не найден.", 404);
  const match: Prisma.CustomerWhereInput[] = [];
  if (customer.email) match.push({ email: customer.email });
  if (customer.normalizedPhone)
    match.push({ normalizedPhone: customer.normalizedPhone });
  const [bookings, duplicates, history] = await Promise.all([
    db.booking.findMany({
      where: { customerId: id },
      include: bookingInclude,
      orderBy: { startAt: "desc" },
    }),
    match.length
      ? db.customer.findMany({
          where: { id: { not: id }, OR: match },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            archivedAt: true,
          },
          take: 20,
        })
      : [],
    db.auditEvent.findMany({
      where: { entityType: "Customer", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    ...customerDto(customer),
    bookings: bookings.map(bookingDto),
    possibleDuplicates: plain(duplicates),
    history: plain(history),
  };
}
export async function createCustomer(raw: unknown, actor: Actor) {
  const input = customerSchema.parse(raw);
  return writeStudio(actor, false, async (client) => {
    const customer = await client.customer.create({
      data: { ...input, normalizedPhone: normalizePhone(input.phone) },
      include: customerInclude,
    });
    await auditChange(
      client,
      actor,
      "Customer",
      customer.id,
      "created",
      null,
      input,
    );
    return customerDto(customer);
  });
}
export async function updateCustomer(id: string, raw: unknown, actor: Actor) {
  const parsed = customerSchema
    .extend({ revision: z.number().int().positive() })
    .parse(raw);
  const { revision, ...input } = parsed;
  return writeStudio(actor, false, async (client) => {
    const previous = await client.customer.findUnique({ where: { id } });
    checkRevision(previous, revision);
    const customer = await client.customer.update({
      where: { id },
      data: {
        ...input,
        normalizedPhone: normalizePhone(input.phone),
        revision: { increment: 1 },
      },
      include: customerInclude,
    });
    await auditChange(
      client,
      actor,
      "Customer",
      id,
      "updated",
      previous,
      customerDto(customer),
    );
    return customerDto(customer);
  });
}
export async function archiveCustomer(id: string, raw: unknown, actor: Actor) {
  const input = z
    .object({ revision: z.number().int().positive(), archived: z.boolean() })
    .strict()
    .parse(raw);
  return writeStudio(actor, false, async (client) => {
    const previous = await client.customer.findUnique({ where: { id } });
    checkRevision(previous, input.revision);
    const customer = await client.customer.update({
      where: { id },
      data: {
        archivedAt: input.archived ? new Date() : null,
        revision: { increment: 1 },
      },
      include: customerInclude,
    });
    await auditChange(
      client,
      actor,
      "Customer",
      id,
      input.archived ? "archived" : "restored",
      previous,
      customerDto(customer),
    );
    return customerDto(customer);
  });
}
