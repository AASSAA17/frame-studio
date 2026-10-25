import { getCatalog } from "@/lib/domain";
import { handle } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(() => getCatalog());
}
