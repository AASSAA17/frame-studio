import { z } from "zod";
import { getAvailability } from "@/lib/domain";
import { handle, rateLimit, requestBucket } from "@/lib/http";
const schema = z.object({
  locationId: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.coerce.number().int().min(5).max(720),
  specialistId: z.string().min(1).max(100).optional(),
  equipmentIds: z.array(z.string().max(100)).max(20),
});
export async function GET(request: Request) {
  return handle(async () => {
    await rateLimit(`availability:${requestBucket(request)}`, 120);
    const p = new URL(request.url).searchParams;
    const input = schema.parse({
      locationId: p.get("locationId"),
      date: p.get("date"),
      durationMinutes: p.get("durationMinutes") || 60,
      specialistId: p.get("specialistId") || undefined,
      equipmentIds: (p.get("equipmentIds") || "").split(",").filter(Boolean),
    });
    return getAvailability(input);
  });
}
