import { expect, test } from "@playwright/test";

test("catalogue shows five real records and the language switch works on mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "У каждой идеи",
  );
  await page
    .getByRole("link", { name: "Выбрать локацию", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/locations$/);
  await expect(page.locator(".location-card")).toHaveCount(5);
  for (const name of ["Daylight", "Loft", "Cyclorama", "Podcast", "Seasonal"]) {
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "kk");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Әр идеяның",
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Әр идеяның",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
});

test("private booking APIs reject an anonymous visitor", async ({
  request,
}) => {
  const response = await request.get("/api/bookings");
  expect(response.status()).toBe(401);
  const crmResponse = await request.get("/api/bookings?scope=crm");
  expect(crmResponse.status()).toBe(401);
});
