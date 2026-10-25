import { calculateQuote } from "@/lib/domain";
import { quoteInputSchema } from "@/lib/domain/types";
import {
  handle,
  readJson,
  assertSameOrigin,
  rateLimit,
  requestBucket,
} from "@/lib/http";
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await rateLimit(`quote:${requestBucket(request)}`, 90);
    return calculateQuote(quoteInputSchema.parse(await readJson(request)));
  });
}
