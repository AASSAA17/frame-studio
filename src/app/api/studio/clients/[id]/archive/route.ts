import { archiveCustomer } from "@/lib/studio";
import {
  actorFor,
  assertSameOrigin,
  handle,
  rateLimit,
  readJson,
  requireStaff,
} from "@/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    requireStaff(actor);
    await rateLimit(`customer-archive:${actor.id}`, 30);
    return archiveCustomer(
      (await context.params).id,
      await readJson(request),
      actor,
    );
  });
}
