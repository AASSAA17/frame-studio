import { getCustomer, updateCustomer } from "@/lib/studio";
import {
  actorFor,
  assertSameOrigin,
  handle,
  rateLimit,
  readJson,
  requireStaff,
} from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const actor = await actorFor(request);
    requireStaff(actor);
    return getCustomer((await context.params).id, actor);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    requireStaff(actor);
    await rateLimit(`customer-update:${actor.id}`, 60);
    return updateCustomer(
      (await context.params).id,
      await readJson(request),
      actor,
    );
  });
}
