import { expect, test } from "@playwright/test";
import { DateTime } from "luxon";
import { createStaffFixture, registerVerifiedClient } from "./helpers";

test("client books a real slot, test payment is idempotent, and only authorized people see the order", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const { origin } = await registerVerifiedClient(page, { viaUI: true });
  const catalogueResponse = await page.request.get("/api/catalog");
  expect(catalogueResponse.ok()).toBeTruthy();
  const catalogue = (await catalogueResponse.json()) as {
    locations: { id: string; slug: string }[];
    settings: { timezone: string };
  };
  const location = catalogue.locations.find((item) => item.slug === "daylight");
  expect(location).toBeDefined();
  const date = DateTime.now()
    .setZone(catalogue.settings.timezone)
    .plus({ days: 14 })
    .toISODate()!;

  await page.goto("/booking");
  await page.getByTestId(`booking-location-${location!.id}`).click();
  await page.getByTestId("booking-next").click();
  const availabilityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/availability" &&
      url.searchParams.get("date") === date
    );
  });
  await page.getByTestId("booking-date").fill(date);
  const availability = (await (await availabilityResponse).json()) as {
    slots: { available: boolean; startAt: string }[];
  };
  const slotIndex = availability.slots.findIndex((slot) => slot.available);
  expect(
    slotIndex,
    "A seeded room should have a free future slot",
  ).toBeGreaterThanOrEqual(0);
  await page.getByTestId(`booking-slot-${slotIndex}`).click();
  await page.getByTestId("booking-next").click();
  await page.getByTestId("booking-name").fill("Тестовый клиент E2E");
  await page.getByTestId("booking-phone").fill("+77000000000");
  await page.getByTestId("booking-next").click();
  await page.getByTestId("booking-rules").check();
  await expect(page.getByTestId("booking-submit")).toBeEnabled();
  const creationResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/bookings" &&
      response.request().method() === "POST",
  );
  await page.getByTestId("booking-submit").click();
  const creation = await creationResponse;
  expect(creation.ok(), "Server must create the booking").toBeTruthy();
  const booking = (await creation.json()) as {
    id: string;
    number: string;
    totalMinor: number;
    depositMinor: number;
    startAt: string;
  };
  await expect(page).toHaveURL(new RegExp(`/account/bookings/${booking.id}$`));
  await expect(
    page.getByText(booking.number, { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("test-payment")).toBeVisible();

  const paymentResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/bookings/${booking.id}/actions` &&
      response.request().method() === "POST",
  );
  await page.getByTestId("test-payment").click();
  const payment = await paymentResponse;
  expect(payment.ok()).toBeTruthy();
  const paid = await payment.json();
  expect(paid).toMatchObject({
    status: "confirmed",
    paidMinor: booking.depositMinor,
    balanceMinor: booking.totalMinor - booking.depositMinor,
  });
  expect(paid.payments).toHaveLength(1);

  const replay = await page.request.post(
    `/api/bookings/${booking.id}/actions`,
    {
      headers: { Origin: origin },
      data: payment.request().postDataJSON(),
    },
  );
  expect(replay.ok()).toBeTruthy();
  const repeated = await replay.json();
  expect(repeated.paidMinor).toBe(paid.paidMinor);
  expect(repeated.payments).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("Подтверждено", { exact: true })).toBeVisible();
  await page.goto("/account");
  await expect(
    page.getByText(booking.number, { exact: false }).first(),
  ).toBeVisible();

  const strangerContext = await browser.newContext({ baseURL: origin });
  try {
    const strangerPage = await strangerContext.newPage();
    await registerVerifiedClient(strangerPage);
    const otherBooking = await strangerPage.request.get(
      `/api/bookings/${booking.id}`,
    );
    expect(
      otherBooking.status(),
      "Another client's order must not be readable",
    ).toBe(404);
    const forbiddenPayment = await strangerPage.request.post(
      `/api/bookings/${booking.id}/actions`,
      {
        headers: { Origin: origin },
        data: {
          action: "test-payment",
          idempotencyKey: "forbidden-e2e-payment",
        },
      },
    );
    expect(forbiddenPayment.status()).toBe(404);
    expect(
      (await strangerPage.request.get("/api/bookings?scope=crm")).status(),
    ).toBe(403);
  } finally {
    await strangerContext.close();
  }

  const staff = await createStaffFixture();
  const staffContext = await browser.newContext({ baseURL: origin });
  try {
    const staffPage = await staffContext.newPage();
    const signIn = await staffPage.request.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: staff,
    });
    expect(signIn.ok()).toBeTruthy();
    const crmResponse = await staffPage.request.get("/api/bookings?scope=crm");
    expect(crmResponse.ok()).toBeTruthy();
    const crmData = await crmResponse.json();
    const orders = Array.isArray(crmData) ? crmData : crmData.bookings;
    expect(
      orders.find((order: { id: string }) => order.id === booking.id),
    ).toMatchObject({ number: booking.number, status: "confirmed" });
    await staffPage.goto("/crm/bookings");
    await expect(
      staffPage.getByText(booking.number, { exact: false }).first(),
    ).toBeVisible();
  } finally {
    await staffContext.close();
  }
});
