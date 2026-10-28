import type { DbClient } from "./catalog";

/** Lock order: studio(shared/exclusive) -> creation key -> Booking -> sorted Resource rows.
 * Management uses exclusive mode; all reservation/payment mutations use shared mode.
 * This prevents a management check from racing a new reservation without reversing row locks.
 */
export async function lockStudio(
  client: DbClient,
  mode: "shared" | "exclusive" = "shared",
) {
  if (mode === "exclusive")
    await client.$queryRaw`SELECT pg_advisory_xact_lock(170291, 1)::text`;
  else
    await client.$queryRaw`SELECT pg_advisory_xact_lock_shared(170291, 1)::text`;
}

export async function lockCreationKey(client: DbClient, key: string) {
  await client.$queryRaw`SELECT pg_advisory_xact_lock(170292, hashtext(${key}))::text`;
}
