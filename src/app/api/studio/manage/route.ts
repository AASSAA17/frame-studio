import { mutateStudio } from "@/lib/studio";
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
    await rateLimit(`studio-manage:${actor.id}`, 60);
    return mutateStudio(await readJson(request), actor);
  });
}
