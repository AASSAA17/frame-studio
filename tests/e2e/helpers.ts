import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

type MailSummary = { ID: string; To: { Address: string }[] };

export async function registerVerifiedClient(
  page: Page,
  options: { viaUI?: boolean } = {},
) {
  const email = `e2e-${randomUUID()}@frame.test`;
  const password = `Test-${randomUUID()}-aA1!`;
  const origin = new URL(
    process.env.E2E_BASE_URL ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000",
  ).origin;
  const mailpit = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(mailpit).hostname)
  ) {
    throw new Error("The E2E mailbox must be a local Mailpit instance.");
  }

  if (options.viaUI) {
    await page.goto("/login");
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await page.getByLabel("Ваше имя", { exact: true }).fill("Тестовый клиент");
    await page.getByLabel("Электронная почта", { exact: true }).fill(email);
    await page.getByLabel(/^Пароль/).fill(password);
    const signupResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/sign-up/email") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Зарегистрироваться", exact: true })
      .click();
    expect(
      (await signupResponse).ok(),
      "Registration must succeed",
    ).toBeTruthy();
    await expect(
      page.getByRole("status").filter({ hasText: "Проверьте почту" }),
    ).toBeVisible();
  } else {
    const signup = await page.request.post("/api/auth/sign-up/email", {
      headers: { Origin: origin },
      data: {
        email,
        password,
        name: "Тестовый клиент",
        callbackURL: "/account",
        role: "OWNER",
      },
    });
    expect(signup.ok(), "Registration must succeed").toBeTruthy();
  }

  const unverifiedLogin = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(
    unverifiedLogin.status(),
    "An unverified email must not be able to sign in",
  ).toBe(403);

  // A successful sign-up alone must not grant access to the client history.
  const unverifiedSession = await page.request.get("/api/session");
  expect((await unverifiedSession.json()).user).toBeNull();

  let messageId = "";
  await expect
    .poll(
      async () => {
        const messagesResponse = await page.request.get(
          `${mailpit}/api/v1/search`,
          {
            params: { query: `to:${email}` },
          },
        );
        expect(messagesResponse.ok()).toBeTruthy();
        const messages = (await messagesResponse.json()) as {
          messages: MailSummary[];
        };
        messageId =
          messages.messages.find((message) =>
            message.To.some((to) => to.Address === email),
          )?.ID ?? "";
        return Boolean(messageId);
      },
      { message: "The local verification email must arrive", timeout: 20_000 },
    )
    .toBeTruthy();

  const messageResponse = await page.request.get(
    `${mailpit}/api/v1/message/${messageId}`,
  );
  expect(messageResponse.ok()).toBeTruthy();
  const message = (await messageResponse.json()) as { Text: string };
  const verificationURL = message.Text.match(
    /https?:\/\/[^\s<>"']+\/api\/auth\/verify-email[^\s<>"']*/,
  )?.[0];
  expect(
    Boolean(verificationURL),
    "Email must contain a verification URL",
  ).toBeTruthy();
  if (!verificationURL || new URL(verificationURL).origin !== origin) {
    throw new Error(
      "Verification link does not belong to the local application.",
    );
  }
  await page.goto(verificationURL);
  await expect
    .poll(async () => {
      const session = await page.request.get("/api/session");
      return (await session.json()).user?.email;
    })
    .toBe(email);

  return { email, password, origin };
}

export async function createStaffFixture() {
  if (process.env.E2E_CREATE_STAFF_FIXTURE !== "1") {
    throw new Error(
      "Set E2E_CREATE_STAFF_FIXTURE=1 for the local CRM test. This creates a synthetic owner account.",
    );
  }
  const databaseURL = process.env.DATABASE_URL;
  if (
    !databaseURL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseURL).hostname)
  ) {
    throw new Error("E2E staff fixtures require a local disposable database.");
  }
  const id = randomUUID();
  const email = `staff-e2e-${id}@frame.test`;
  const password = `Test-${randomUUID()}-aA1!`;
  const passwordHash = await hashPassword(password);
  const fixtureDB = new PrismaClient();
  try {
    await fixtureDB.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id,
          email,
          name: "Тестовый сотрудник E2E",
          role: "OWNER",
          emailVerified: true,
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    });
  } finally {
    await fixtureDB.$disconnect();
  }
  return { email, password };
}
