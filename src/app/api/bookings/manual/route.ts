import { createManualBooking } from "@/lib/studio";
import {
  actorFor,
  assertSameOrigin,
  handle,
  rateLimit,
  readJson,
  requireStaff,
} from "@/lib/http";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    requireStaff(actor);
    await rateLimit(`manual-booking:${actor.id}`, 30);
    return createManualBooking(await readJson(request), actor);
  });
}
