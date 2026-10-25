import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "./auth";
import { db } from "./db";
import { DomainError, type Actor } from "./domain/types";

export async function actorFor(request: Request): Promise<Actor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user)
    throw new DomainError("UNAUTHORIZED", "Войдите в личный кабинет.", 401);
  if (!session.user.emailVerified)
    throw new DomainError(
      "EMAIL_UNVERIFIED",
      "Подтвердите электронную почту.",
      403,
    );
  // Read the current role from the DB; revoked permissions take effect immediately.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (!user) throw new DomainError("UNAUTHORIZED", "Сессия завершена.", 401);
  return user;
}

export function requireStaff(actor: Actor) {
  if (!["OWNER", "ADMIN"].includes(actor.role))
    throw new DomainError("FORBIDDEN", "Нет доступа к этому разделу.", 403);
}

export function assertSameOrigin(request: Request) {
  const allowed = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
  ).origin;
  if (request.headers.get("origin") !== allowed)
    throw new DomainError(
      "INVALID_ORIGIN",
      "Обновите страницу перед отправкой формы.",
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new DomainError(
      "INVALID_ORIGIN",
      "Недопустимый источник запроса.",
      403,
    );
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new DomainError("CONTENT_TYPE", "Ожидается JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_BODY", "Пустой запрос.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32_768) {
      await reader.cancel();
      throw new DomainError("BODY_TOO_LARGE", "Слишком большой запрос.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("INVALID_JSON", "Некорректный JSON.");
  }
}

export async function rateLimit(key: string, max = 60, windowSeconds = 60) {
  const now = Date.now();
  const hashedKey = `api:${createHash("sha256").update(key).digest("hex")}`;
  const cutoff = BigInt(now - windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${hashedKey}, 1, ${BigInt(now)})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."lastRequest" < ${cutoff} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${cutoff} THEN ${BigInt(now)} ELSE "RateLimit"."lastRequest" END
    RETURNING "count"`;
  if (rows[0].count > max)
    throw new DomainError(
      "RATE_LIMITED",
      "Слишком много запросов. Повторите через минуту.",
      429,
    );
}

export function requestBucket(request: Request) {
  // Untrusted forwarded headers cannot create arbitrary independent buckets.
  const header = process.env.TRUSTED_IP_HEADER;
  return header ? request.headers.get(header) || "shared" : "shared";
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return result instanceof Response ? result : json(result);
  } catch (error) {
    if (error instanceof DomainError)
      return json(
        { error: error.message, message: error.message, code: error.code },
        error.status,
      );
    if (error instanceof ZodError)
      return json(
        {
          error: "Проверьте поля формы.",
          code: "VALIDATION",
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    const requestId = randomUUID();
    // Do not log request bodies, tokens, contacts or raw database errors.
    console.error(
      JSON.stringify({
        level: "error",
        event: "request_failed",
        requestId,
        type: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return json(
      {
        error: "Не удалось выполнить запрос. Попробуйте позже.",
        code: "INTERNAL",
        requestId,
      },
      500,
    );
  }
}
