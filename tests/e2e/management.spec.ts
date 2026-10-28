import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import {
  authPost,
  createStaffFixture,
  registerVerifiedClient,
} from "./helpers";

const origin = process.env.E2E_BASE_URL!;
const headers = { Origin: origin };
async function login(
  page: Page,
  role: "OWNER" | "ADMIN" | "SPECIALIST" = "OWNER",
) {
  const fixture = await createStaffFixture(role);
  const response = await authPost(
    page,
    "/api/auth/sign-in/email",
    { email: fixture.email, password: fixture.password },
    origin,
  );
  expect(response.ok()).toBeTruthy();
  return fixture;
}
async function state(page: Page) {
  const response = await page.request.get("/api/studio");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function mutate(page: Page, data: Record<string, unknown>) {
  return page.request.post("/api/studio/manage", { headers, data });
}

test("management roles are checked on every request, including an existing revoked session", async ({
  page,
  browser,
}) => {
  const owner = await login(page);
  await state(page);
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { id: owner.id }, data: { role: "CLIENT" } });
    expect((await page.request.get("/api/studio")).status()).toBe(403);
    expect(
      (
        await mutate(page, {
          entity: "room",
          operation: "create",
          name: "Запрещённый зал",
          capacity: 10,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await db.$disconnect();
  }

  for (const role of ["ADMIN", "SPECIALIST"] as const) {
    const context = await browser.newContext({ baseURL: origin });
    try {
      const staffPage = await context.newPage();
      await login(staffPage, role);
      if (role === "ADMIN") {
        const current = await state(staffPage);
        expect(
          (
            await mutate(staffPage, {
              entity: "settings",
              operation: "update",
              revision: current.settings.revision,
              name: "Недопустимо",
            })
          ).status(),
        ).toBe(403);
        await staffPage.goto("/crm/settings");
        await expect(staffPage.getByTestId("field-name")).toBeDisabled();
        await expect(staffPage.getByTestId("settings-save")).toHaveCount(0);
      } else {
        expect((await staffPage.request.get("/api/studio")).status()).toBe(403);
        expect(
          (await staffPage.request.get("/api/studio/clients")).status(),
        ).toBe(403);
      }
    } finally {
      await context.close();
    }
  }
});

test("settings UI preserves unsaved edits and saves current public metadata with conflict protection", async ({
  page,
}) => {
  await login(page);
  const original = (await state(page)).settings;
  try {
    const stamp = randomUUID().slice(0, 6);
    await page.goto("/crm/rooms");
    await page.getByRole("link", { name: "Настройки", exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/settings$/);
    const name = page.getByTestId("field-name");
    await name.fill(`Черновик ${stamp}`);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("link", { name: "Физические залы", exact: true })
      .click();
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await expect(name).toHaveValue(`Черновик ${stamp}`);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goBack({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await expect(name).toHaveValue(`Черновик ${stamp}`);

    await name.fill(original.name);
    await page.getByRole("link", { name: "Клиенты", exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/clients$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await name.fill(`Черновик вперёд ${stamp}`);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.goForward({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await expect(name).toHaveValue(`Черновик вперёд ${stamp}`);

    await name.fill(`FRAME E2E ${stamp}`);
    await page.getByTestId("field-city").fill("Тестовый город");
    const save = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/studio/manage") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("settings-save").click();
    expect((await save).ok()).toBeTruthy();
    await expect(page.getByRole("status")).toContainText("Настройки сохранены");
    const current = (await state(page)).settings;
    expect(current.name).toBe(`FRAME E2E ${stamp}`);
    const home = await page.request.get("/");
    expect(await home.text()).toContain(`FRAME E2E ${stamp}`);
    expect(await home.text()).toContain("Тестовый город");
    expect(
      (
        await mutate(page, {
          entity: "settings",
          operation: "update",
          revision: original.revision,
          name: "Устаревшая вкладка",
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await mutate(page, {
          entity: "settings",
          operation: "update",
          revision: current.revision,
          timezone: "Wrong/Zone",
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await mutate(page, {
          entity: "settings",
          operation: "update",
          revision: current.revision,
          minimumMinutes: 15,
          stepMinutes: 15,
        })
      ).ok(),
    ).toBeTruthy();
    const available = await page.request.get("/api/availability", {
      params: {
        locationId: "daylight",
        date: DateTime.now()
          .setZone("Asia/Almaty")
          .plus({ days: 35 })
          .toISODate()!,
        durationMinutes: "15",
      },
    });
    expect(available.ok()).toBeTruthy();
    const slot = (await available.json()).slots.find(
      (item: { available: boolean }) => item.available,
    );
    expect(slot).toBeTruthy();
    expect(
      (
        await page.request.post("/api/quote", {
          headers,
          data: {
            locationId: "daylight",
            startAt: slot.startAt,
            durationMinutes: 15,
            purpose: "photo",
            guests: 1,
            serviceIds: [],
            equipmentIds: [],
          },
        })
      ).ok(),
    ).toBeTruthy();
  } finally {
    const current = (await state(page)).settings;
    const restore = await mutate(page, {
      entity: "settings",
      operation: "update",
      revision: current.revision,
      name: original.name,
      city: original.city,
      minimumMinutes: original.minimumMinutes,
      stepMinutes: original.stepMinutes,
    });
    expect(restore.ok()).toBeTruthy();
  }
});

test("room editor creates, updates and archives a record; server errors keep entered values", async ({
  page,
}) => {
  await login(page);
  const roomName = `Зал E2E ${randomUUID().slice(0, 6)}`;
  await page.goto("/crm/rooms");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(roomName);
  await page.getByTestId("field-capacity").fill("12");
  await page.getByTestId("manage-save").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = (await state(page)).rooms.find(
    (room: { name: string }) => room.name === roomName,
  );
  expect(created).toBeTruthy();
  await page.getByTestId(`edit-room-${created.id}`).click();
  await page.getByTestId("field-name").fill(`${roomName} изменён`);
  await page.getByTestId("manage-save").click();
  await expect(
    page.getByRole("heading", { name: `${roomName} изменён`, exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId(`archive-room-${created.id}`).click();
  await expect(page.getByTestId(`edit-room-${created.id}`)).toHaveCount(0);
  await page.getByLabel("Показать архив", { exact: true }).check();
  await expect(
    page.getByRole("heading", { name: `${roomName} изменён`, exact: true }),
  ).toBeVisible();

  await page.goto("/crm/locations");
  await page.getByTestId("edit-location-daylight").click();
  const priorPrice = await page
    .getByTestId("field-hourlyPriceMinor")
    .inputValue();
  await page.getByTestId("field-hourlyPriceMinor").fill("0");
  // Bypass only native constraints so this exercises the actual server validation and error UI.
  await page
    .getByRole("dialog")
    .locator("form")
    .evaluate((form) => ((form as HTMLFormElement).noValidate = true));
  const failure = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/manage") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("manage-save").click();
  expect((await failure).status()).toBe(400);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("field-hourlyPriceMinor")).toHaveValue("0");
  await page.getByTestId("field-hourlyPriceMinor").fill(priorPrice);
  await page.getByTestId("manage-cancel").click();
});

test("staff creates a client and manual booking through the UI with immutable identity and conflict details", async ({
  page,
  browser,
}) => {
  await login(page);
  const customerName = `Клиент E2E ${randomUUID().slice(0, 6)}`;
  await page.goto("/crm/clients");
  await page.getByTestId("client-add").click();
  await page.getByTestId("field-name").fill(customerName);
  await page.getByTestId("field-phone").fill("+70000000003");
  await page.getByTestId("field-notes").fill("INTERNAL_E2E_ONLY");
  await page.getByTestId("manage-save").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: customerName, exact: true }).click();
  await page.getByTestId("client-book").click();
  await page.getByTestId("manual-location").selectOption("loft");
  const date = DateTime.now()
    .setZone("Asia/Almaty")
    .plus({ days: 28 })
    .toISODate()!;
  await page.getByTestId("manual-date").fill(date);
  await page
    .locator('[data-testid^="manual-slot-"]:not([disabled])')
    .first()
    .click();
  await page.getByTestId("manual-rules").check();
  await expect(page.getByTestId("manual-submit")).toBeEnabled();
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/bookings/manual") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("manual-submit").click();
  const response = await createdResponse;
  expect(response.ok()).toBeTruthy();
  const payload = response.request().postDataJSON();
  expect(payload.expectedQuoteFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const booking = await response.json();
  await expect(page).toHaveURL(new RegExp(`/crm/bookings/${booking.id}$`));
  expect(
    (
      await page.request.post("/api/bookings/manual", {
        headers,
        data: payload,
      })
    ).ok(),
  ).toBeTruthy();
  const db = new PrismaClient();
  try {
    const stored = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(stored.userId).toBeNull();
    expect(
      await db.booking.count({ where: { customerId: stored.customerId } }),
    ).toBe(1);
  } finally {
    await db.$disconnect();
  }
  const inventory = await state(page);
  const location = inventory.locations.find(
    (item: { id: string }) => item.id === "loft",
  );
  const conflict = await mutate(page, {
    entity: "location",
    operation: "archive",
    id: location.id,
    revision: location.revision,
  });
  expect(conflict.status()).toBe(409);
  expect(JSON.stringify(await conflict.json())).toContain(booking.number);
  const outsider = await browser.newContext({ baseURL: origin });
  try {
    const outsiderPage = await outsider.newPage();
    await registerVerifiedClient(outsiderPage);
    expect(
      (await outsiderPage.request.get(`/api/bookings/${booking.id}`)).status(),
    ).toBe(404);
    expect(
      (await outsiderPage.request.get("/api/studio/clients")).status(),
    ).toBe(403);
  } finally {
    await outsider.close();
  }
  expect(
    (
      await page.request.post("/api/studio/clients", {
        headers,
        data: { name: "Подмена", userId: randomUUID() },
      })
    ).status(),
  ).toBe(400);
});

test("open client and schedule editors retain their revisions during another staff edit", async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post("/api/studio/clients", {
    headers,
    data: { name: `Версия ${randomUUID().slice(0, 6)}` },
  });
  expect(created.ok()).toBeTruthy();
  const customer = await created.json();
  await page.goto(`/crm/clients/${customer.id}`);
  await page.getByTestId("client-edit").click();
  await page.getByTestId("field-name").fill("Черновик открытой формы");
  const changed = await page.request.patch(
    `/api/studio/clients/${customer.id}`,
    {
      headers,
      data: {
        name: "Изменение другого сотрудника",
        revision: customer.revision,
      },
    },
  );
  expect(changed.ok()).toBeTruthy();
  const refresh = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/studio/clients/${customer.id}`) &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("studio-updated")));
  await refresh;
  await expect(page.getByTestId("field-name")).toHaveValue(
    "Черновик открытой формы",
  );
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/studio/clients/${customer.id}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByTestId("manage-save").click();
  expect((await rejected).status()).toBe(409);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/studio/clients/${customer.id}`)
      ).json()
    ).name,
  ).toBe("Изменение другого сотрудника");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("manage-cancel").click();

  const roomResponse = await mutate(page, {
    entity: "room",
    operation: "create",
    name: `Версия графика ${randomUUID().slice(0, 6)}`,
    capacity: 8,
  });
  expect(roomResponse.ok()).toBeTruthy();
  const room = await roomResponse.json();
  const resource = (await state(page)).resources.find(
    (item: { id: string }) => item.id === room.resourceId,
  );
  await page.goto("/crm/rooms");
  await page.getByTestId(`schedule-resource-${resource.id}`).click();
  await page.getByTestId("schedule-edit").click();
  await page.getByTestId("field-closeHour").fill("20");
  expect(
    (
      await mutate(page, {
        entity: "schedule",
        operation: "update",
        id: resource.id,
        revision: resource.revision,
        openHour: 9,
        closeHour: resource.closeHour,
        weekdays: resource.weekdays,
      })
    ).ok(),
  ).toBeTruthy();
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio") &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("studio-updated")));
  await refreshed;
  const staleSchedule = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/studio/manage") &&
      response.request().method() === "POST",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("manage-save").click();
  expect((await staleSchedule).status()).toBe(409);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("field-closeHour")).toHaveValue("20");
  const retained = (await state(page)).resources.find(
    (item: { id: string }) => item.id === resource.id,
  );
  expect(retained.openHour).toBe(9);
  expect(retained.closeHour).toBe(resource.closeHour);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("manage-cancel").click();
  expect(
    (
      await mutate(page, {
        entity: "room",
        operation: "archive",
        id: room.id,
        revision: room.revision,
      })
    ).ok(),
  ).toBeTruthy();
});

test("management screens remain usable at 390, 768 and 1440 pixels", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const clientsResponse = await page.request.get("/api/studio/clients");
  const clients = await clientsResponse.json();
  const customer =
    clients.find(
      (item: { bookingCount: number; archivedAt: string | null }) =>
        item.bookingCount > 0 && !item.archivedAt,
    ) ?? clients[0];
  expect(customer).toBeTruthy();
  const inventory = await state(page);
  const decor = inventory.decorVersions.find(
    (item: { locationId: string }) => item.locationId === "daylight",
  );
  const routes = [
    { key: "settings", path: "settings" },
    { key: "rooms", path: "rooms" },
    { key: "locations", path: "locations" },
    { key: "location-editor", path: "locations" },
    { key: "team", path: "team" },
    { key: "equipment", path: "equipment" },
    { key: "services", path: "services" },
    { key: "clients", path: "clients" },
    { key: "client-detail", path: `clients/${customer.id}` },
    { key: "bookings-new", path: "bookings/new" },
    { key: "location-decor", path: "locations" },
    { key: "room-schedule", path: "rooms" },
  ];
  await mkdir(resolve("docs/screenshots"), { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const { key, path } of routes) {
      await page.goto(`/crm/${path}`);
      await expect(page.locator("main h1").first()).toBeVisible();
      if (key === "location-editor") {
        await page.getByTestId("edit-location-daylight").click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else if (key === "location-decor") {
        await page.getByTestId("decor-location-daylight").click();
        await page.getByTestId(`edit-decor-${decor.id}`).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else if (key === "room-schedule") {
        await page.getByTestId("schedule-resource-room-light-resource").click();
        await page.getByTestId("schedule-edit").click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else if (key === "settings")
        await expect(page.getByTestId("field-name")).toHaveValue(
          "FRAME STUDIO",
        );
      else if (key === "rooms")
        await expect(page.getByTestId("edit-room-room-light")).toBeVisible();
      else if (key === "bookings-new") {
        await expect(page.getByTestId("manual-client")).toBeVisible();
        await page.getByTestId("manual-location").selectOption("daylight");
        await page
          .getByTestId("manual-date")
          .fill(
            DateTime.now()
              .setZone("Asia/Almaty")
              .plus({ days: 35 })
              .toISODate()!,
          );
        await expect(
          page.locator('[data-testid^="manual-slot-"]').first(),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: resolve(`docs/screenshots/stage2-${key}-${width}.png`),
        fullPage: ![
          "location-editor",
          "location-decor",
          "room-schedule",
        ].includes(key),
      });
      if (["location-editor", "location-decor", "room-schedule"].includes(key))
        await page.getByTestId("manage-cancel").click();
      if (key === "bookings-new")
        await page.getByTestId("manual-location").selectOption("");
    }
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/crm/settings");
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Студия параметрлері",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "kk");
  await page.screenshot({
    path: resolve("docs/screenshots/stage2-settings-kk-390.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Настройки студии",
  );
});
