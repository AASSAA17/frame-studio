import { createCustomer, listCustomers } from "@/lib/studio";
import {
  actorFor,
  assertSameOrigin,
  handle,
  rateLimit,
  readJson,
  requireStaff,
} from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const actor = await actorFor(request);
    requireStaff(actor);
    return listCustomers(
      new URL(request.url).searchParams.get("q") ?? "",
      actor,
    );
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const actor = await actorFor(request);
    requireStaff(actor);
    await rateLimit(`customer-create:${actor.id}`, 30);
    return createCustomer(await readJson(request), actor);
  });
}
