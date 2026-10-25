import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { assertSameOrigin, handle, rateLimit, requestBucket } from "@/lib/http";
export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const path = new URL(request.url).pathname;
    const max = path.endsWith("/request-password-reset")
      ? 3
      : path.endsWith("/sign-up/email")
        ? 8
        : 30;
    await rateLimit(`auth:${path}:${requestBucket(request)}`, max);
    return handlers.POST(request);
  });
}
