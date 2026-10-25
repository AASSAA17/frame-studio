import { db } from "@/lib/db";
import { json } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return json({ status: "ok", database: "ok" });
  } catch {
    return json({ status: "unavailable", database: "unavailable" }, 503);
  }
}
