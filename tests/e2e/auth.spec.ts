import { expect, test } from "@playwright/test";
import { registerVerifiedClient } from "./helpers";

test("email verification is required and authenticated mutations require the application origin", async ({
  page,
}) => {
  const { email, origin } = await registerVerifiedClient(page);
  const sessionResponse = await page.request.get("/api/session");
  const session = await sessionResponse.json();
  expect(session.user).toMatchObject({ email, role: "CLIENT" });

  const forbiddenCRM = await page.request.get("/api/bookings?scope=crm");
  expect(forbiddenCRM.status()).toBe(403);

  const missingOrigin = await page.request.post("/api/bookings", { data: {} });
  expect(missingOrigin.status()).toBe(403);
  const wrongOrigin = await page.request.post("/api/bookings", {
    headers: { Origin: "https://unrelated.invalid" },
    data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  const invalidInput = await page.request.post("/api/bookings", {
    headers: { Origin: origin },
    data: {},
  });
  expect(invalidInput.status()).toBe(400);

  const logout = await page.request.post("/api/auth/sign-out", {
    headers: { Origin: origin },
    data: {},
  });
  expect(logout.ok()).toBeTruthy();
  expect((await page.request.get("/api/bookings")).status()).toBe(401);
});
