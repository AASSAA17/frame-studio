import { getBooking } from "@/lib/domain";
import { actorFor, handle } from "@/lib/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () =>
    getBooking((await context.params).id, await actorFor(request)),
  );
}
