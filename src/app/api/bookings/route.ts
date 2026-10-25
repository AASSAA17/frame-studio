import { createBooking, listBookings } from "@/lib/domain";
import { bookingInputSchema } from "@/lib/domain/types";
import {
  actorFor,
  assertSameOrigin,
  handle,
  readJson,
  requireStaff,
  rateLimit,
} from "@/lib/http";
export async function GET(request: Request) {
  return handle(async () => {
    const actor = await actorFor(request);
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "crm") requireStaff(actor);
    const bookings = await listBookings(actor);
    return scope === "crm" || scope === "specialist"
      ? bookings
      : bookings.filter((b) => "userId" in b && b.userId === actor.id);
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    await rateLimit(`booking:${actor.id}`, 10);
    return createBooking(
      bookingInputSchema.parse(await readJson(request)),
      actor.id,
    );
  });
}
