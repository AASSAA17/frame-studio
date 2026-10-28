import { getAdminStudio } from "@/lib/studio";
import { actorFor, handle, requireStaff } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const actor = await actorFor(request);
    requireStaff(actor);
    return getAdminStudio(actor);
  });
}
