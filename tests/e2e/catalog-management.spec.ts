import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { StudioData } from "../../src/components/management-shared";
import type { Catalog } from "../../src/components/api";
import { authPost, createStaffFixture } from "./helpers";

const origin = process.env.E2E_BASE_URL!;

async function login(page: Page) {
  const fixture = await createStaffFixture("OWNER");
  const response = await authPost(
    page,
    "/api/auth/sign-in/email",
    { email: fixture.email, password: fixture.password },
    origin,
  );
  expect(response.ok()).toBeTruthy();
}

async function studio(page: Page): Promise<StudioData> {
  const response = await page.request.get("/api/studio");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function catalog(page: Page): Promise<Catalog> {
  const response = await page.request.get("/api/catalog");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// All writes below originate from actual form controls. API reads independently
// verify persistence, publication and availability after each successful write.
async function mutation(
  page: Page,
  entity: string,
  operation: string,
  button: Locator = page.getByTestId("manage-save"),
  confirm = false,
) {
  const pending = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/studio/manage") ||
      response.request().method() !== "POST"
    )
      return false;
    const command = response.request().postDataJSON();
    return command.entity === entity && command.operation === operation;
  });
  if (confirm) page.once("dialog", (dialog) => dialog.accept());
  await button.click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return body;
}

async function archive(page: Page, entity: string, id: string) {
  await mutation(
    page,
    entity,
    "archive",
    page.getByTestId(`archive-${entity}-${id}`),
    true,
  );
  await expect(page.getByTestId(`edit-${entity}-${id}`)).toHaveCount(0);
  await page.getByLabel("Показать архив", { exact: true }).check();
  await expect(page.getByTestId(`archive-${entity}-${id}`)).toBeDisabled();
}

async function createRoom(page: Page, name: string) {
  await page.goto("/crm/rooms");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(name);
  await page.getByTestId("field-capacity").fill("12");
  await mutation(page, "room", "create");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const room = (await studio(page)).rooms.find((item) => item.name === name);
  expect(room).toBeTruthy();
  return room!;
}

async function createLocation(page: Page, roomId: string, stamp: string) {
  const name = `Локация UI ${stamp}`;
  await page.goto("/crm/locations");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(name);
  await page.getByTestId("field-slug").fill(`ui-${stamp}`);
  await page.getByTestId("field-roomId").selectOption(roomId);
  await page.getByTestId("field-area").fill("45");
  await page.getByTestId("field-capacity").fill("8");
  await page.getByTestId("field-hourlyPriceMinor").fill("17500.50");
  await page.getByTestId("field-image").fill("/images/loft.svg");
  await page.getByTestId("field-tags").fill("Портрет, Каталог");
  await page
    .getByTestId("field-description")
    .fill("Локация для проверки управления через интерфейс.");
  await page
    .getByTestId("field-descriptionKk")
    .fill("Интерфейс арқылы басқаруды тексеруге арналған локация.");
  await page.getByTestId("field-published").check();
  await mutation(page, "location", "create");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const location = (await studio(page)).locations.find(
    (item) => item.name === name,
  );
  expect(location).toMatchObject({
    roomId,
    slug: `ui-${stamp}`,
    hourlyPriceMinor: 1_750_050,
    published: true,
    area: 45,
    capacity: 8,
    tags: ["Портрет", "Каталог"],
  });
  return location!;
}

async function createDecor(
  page: Page,
  name: string,
  start: DateTime,
  end: DateTime | null,
  image: string,
) {
  await page.getByTestId("decor-add").click();
  await page.getByTestId("field-name").fill(name);
  await page.getByTestId("field-image").fill(image);
  await page
    .getByTestId("field-validFrom")
    .fill(start.toFormat("yyyy-MM-dd'T'HH:mm"));
  await page
    .getByTestId("field-validUntil")
    .fill(end?.toFormat("yyyy-MM-dd'T'HH:mm") ?? "");
  await page.getByTestId("field-published").check();
  await mutation(page, "decor", "create");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const version = (await studio(page)).decorVersions.find(
    (item) => item.name === name,
  );
  expect(version).toMatchObject({ name, image, published: true });
  expect(DateTime.fromISO(version!.validFrom).toMillis()).toBe(
    start.toMillis(),
  );
  return version!;
}

test("room, location and current/future decor are managed and published through the UI", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const stamp = randomUUID().slice(0, 8);
  const room = await createRoom(page, `Зал локации UI ${stamp}`);
  const location = await createLocation(page, room.id, stamp);

  await page.getByTestId(`edit-location-${location.id}`).click();
  await page.getByTestId("field-name").fill(`${location.name} обновлена`);
  await page.getByTestId("field-hourlyPriceMinor").fill("18000.75");
  await mutation(page, "location", "update");
  await expect(
    page.getByRole("heading", {
      name: `${location.name} обновлена`,
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await studio(page)).locations.find((item) => item.id === location.id),
  ).toMatchObject({ hourlyPriceMinor: 1_800_075 });

  await page.getByTestId(`decor-location-${location.id}`).click();
  const zone = (await studio(page)).settings.timezone;
  const today = DateTime.now().setZone(zone).startOf("day");
  const boundary = today.plus({ days: 30 });
  const current = await createDecor(
    page,
    `Текущее UI ${stamp}`,
    today.minus({ days: 1 }),
    boundary,
    "/images/daylight.svg",
  );
  const future = await createDecor(
    page,
    `Будущее UI ${stamp}`,
    boundary,
    null,
    "/images/seasonal.svg",
  );
  const currentCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: current.name, exact: true }),
  });
  const futureCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: future.name, exact: true }),
  });
  await expect(currentCard).toContainText("Действует сейчас");
  await expect(futureCard).toContainText("Будущее оформление");

  await page.getByTestId(`edit-decor-${future.id}`).click();
  await page.getByTestId("field-name").fill(`${future.name} обновлено`);
  await mutation(page, "decor", "update");
  await expect(
    page.getByRole("heading", {
      name: `${future.name} обновлено`,
      exact: true,
    }),
  ).toBeVisible();
  const published = (await catalog(page)).locations.find(
    (item) => item.id === location.id,
  );
  expect(published).toMatchObject({
    name: `${location.name} обновлена`,
    hourlyPriceMinor: 1_800_075,
    currentVersion: { id: current.id, image: "/images/daylight.svg" },
    futureVersions: [
      {
        id: future.id,
        name: `${future.name} обновлено`,
        image: "/images/seasonal.svg",
      },
    ],
  });

  await page.goto(`/locations/${location.slug}`);
  await expect(
    page.getByRole("heading", {
      name: `${location.name} обновлена.`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".detail-image")).toHaveAttribute(
    "src",
    "/images/daylight.svg",
  );
  await expect(
    page.getByText(`${future.name} обновлено`, { exact: true }),
  ).toBeVisible();
  await page.goto("/crm/locations");
  await archive(page, "location", location.id);
  expect(
    (await catalog(page)).locations.some((item) => item.id === location.id),
  ).toBe(false);
  expect(
    (await studio(page)).locations.find((item) => item.id === location.id)
      ?.archivedAt,
  ).toBeTruthy();
  await page.goto("/crm/rooms");
  await archive(page, "room", room.id);
  expect(
    (await studio(page)).rooms.find((item) => item.id === room.id)?.archivedAt,
  ).toBeTruthy();
});

test("specialist, equipment maintenance and service CRUD persist from their UI controls", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const stamp = randomUUID().slice(0, 8);
  const specialistName = `Фотограф UI ${stamp}`;
  await page.goto("/crm/team");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(specialistName);
  await page.getByTestId("field-specialty").fill("Предметная съёмка");
  await page.getByTestId("field-hourlyPriceMinor").fill("12000.25");
  await page.getByTestId("field-published").check();
  await mutation(page, "specialist", "create");
  await expect(
    page.getByRole("heading", { name: specialistName, exact: true }),
  ).toBeVisible();
  const specialist = (await studio(page)).specialists.find(
    (item) => item.name === specialistName,
  )!;
  expect(specialist).toMatchObject({
    specialty: "Предметная съёмка",
    hourlyPriceMinor: 1_200_025,
    published: true,
  });
  await page.getByTestId(`edit-specialist-${specialist.id}`).click();
  await page.getByTestId("field-specialty").fill("Портрет и каталог");
  await mutation(page, "specialist", "update");
  await expect(
    page.locator("article").filter({
      has: page.getByRole("heading", { name: specialistName, exact: true }),
    }),
  ).toContainText("Портрет и каталог");
  expect(
    (await catalog(page)).specialists.find((item) => item.id === specialist.id),
  ).toMatchObject({ specialty: "Портрет и каталог" });

  const equipmentName = `Свет UI ${stamp}`;
  await page.goto("/crm/equipment");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(equipmentName);
  await page.getByTestId("field-priceMinor").fill("2500.50");
  await page.getByTestId("field-quantity").fill("2");
  await page.getByTestId("field-published").check();
  await mutation(page, "equipment", "create");
  await expect(
    page.getByRole("heading", { name: equipmentName, exact: true }),
  ).toBeVisible();
  let state = await studio(page);
  const equipment = state.equipment.find(
    (item) => item.name === equipmentName,
  )!;
  expect(equipment).toMatchObject({
    priceMinor: 250_050,
    quantity: 2,
    availableQuantity: 2,
  });
  await page.getByTestId(`edit-equipment-${equipment.id}`).click();
  await page.getByTestId("field-quantity").fill("3");
  await mutation(page, "equipment", "update");
  const equipmentCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: equipmentName, exact: true }),
  });
  await expect(equipmentCard).toContainText("Работает: 3 / 3");
  state = await studio(page);
  const resource = state.resources.find(
    (item) => item.id === equipment.resourceId,
  )!;
  const unit = resource.units.find((item) => !item.retiredAt)!;
  expect(resource.units.filter((item) => !item.retiredAt)).toHaveLength(3);
  await page.getByTestId(`edit-unit-${unit.id}`).click();
  await page.getByTestId("field-active").uncheck();
  await page.getByTestId("field-maintenanceNote").fill(`Замена лампы ${stamp}`);
  await mutation(page, "unit", "update", page.getByTestId("manage-save"), true);
  await expect(equipmentCard).toContainText("Работает: 2 / 3");
  await expect(equipmentCard).toContainText(`Замена лампы ${stamp}`);
  expect(
    (await studio(page)).resources
      .find((item) => item.id === resource.id)
      ?.units.find((item) => item.id === unit.id),
  ).toMatchObject({ active: false, maintenanceNote: `Замена лампы ${stamp}` });
  expect(
    (await catalog(page)).equipment.find((item) => item.id === equipment.id)
      ?.quantity,
  ).toBe(2);
  await page.getByTestId(`edit-unit-${unit.id}`).click();
  await page.getByTestId("field-active").check();
  await page.getByTestId("field-maintenanceNote").fill("Лампа заменена");
  await mutation(page, "unit", "update");
  await expect(equipmentCard).toContainText("Работает: 3 / 3");
  expect(
    (await catalog(page)).equipment.find((item) => item.id === equipment.id)
      ?.quantity,
  ).toBe(3);

  const serviceName = `Ретушь UI ${stamp}`;
  await page.goto("/crm/services");
  await page.getByTestId("manage-add").click();
  await page.getByTestId("field-name").fill(serviceName);
  await page.getByTestId("field-priceMinor").fill("3500.75");
  await page
    .getByTestId("field-description")
    .fill("Ретушь одного выбранного кадра.");
  await page.getByTestId("field-production").check();
  await page.getByTestId("field-published").check();
  await mutation(page, "service", "create");
  await expect(
    page.getByRole("heading", { name: serviceName, exact: true }),
  ).toBeVisible();
  const service = (await studio(page)).services.find(
    (item) => item.name === serviceName,
  )!;
  expect(service).toMatchObject({
    priceMinor: 350_075,
    production: true,
    published: true,
  });
  await page.getByTestId(`edit-service-${service.id}`).click();
  await page
    .getByTestId("field-description")
    .fill("Ретушь двух выбранных кадров.");
  await page.getByTestId("field-priceMinor").fill("6000");
  await mutation(page, "service", "update");
  await expect(
    page.locator("article").filter({
      has: page.getByRole("heading", { name: serviceName, exact: true }),
    }),
  ).toContainText("Ретушь двух выбранных кадров.");
  expect(
    (await catalog(page)).services.find((item) => item.id === service.id),
  ).toMatchObject({ priceMinor: 600_000 });

  await archive(page, "service", service.id);
  expect(
    (await catalog(page)).services.some((item) => item.id === service.id),
  ).toBe(false);
  await page.goto("/crm/equipment");
  await archive(page, "equipment", equipment.id);
  expect(
    (await catalog(page)).equipment.some((item) => item.id === equipment.id),
  ).toBe(false);
  await page.goto("/crm/team");
  await archive(page, "specialist", specialist.id);
  expect(
    (await catalog(page)).specialists.some((item) => item.id === specialist.id),
  ).toBe(false);
});

type Slot = { startAt: string; endAt: string; available: boolean };
async function slots(
  page: Page,
  locationId: string,
  date: string,
  durationMinutes: number,
): Promise<Slot[]> {
  const response = await page.request.get("/api/availability", {
    params: { locationId, date, durationMinutes },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).slots;
}

test("resource schedule, closure and date exception editors change real availability", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const stamp = randomUUID().slice(0, 8);
  const room = await createRoom(page, `График UI ${stamp}`);
  const location = await createLocation(page, room.id, stamp);
  const settings = (await studio(page)).settings;
  const today = DateTime.now().setZone(settings.timezone).startOf("day");
  await page.getByTestId(`decor-location-${location.id}`).click();
  await createDecor(
    page,
    `График оформление ${stamp}`,
    today.minus({ days: 1 }),
    null,
    "/images/daylight.svg",
  );

  await page.goto("/crm/rooms");
  await page.getByTestId(`schedule-resource-${room.resourceId}`).click();
  await page.getByTestId("schedule-edit").click();
  await page.getByTestId("field-openHour").fill("10");
  await page.getByTestId("field-closeHour").fill("21");
  for (let day = 1; day <= 6; day++)
    await page.getByTestId(`field-weekday-${day}`).check();
  await page.getByTestId("field-weekday-7").uncheck();
  await mutation(
    page,
    "schedule",
    "update",
    page.getByTestId("manage-save"),
    true,
  );
  await expect(page.getByLabel("Рабочие дни", { exact: true })).toContainText(
    "10:00 — 21:00",
  );
  const scheduled = (await studio(page)).resources.find(
    (item) => item.id === room.resourceId,
  )!;
  expect(scheduled).toMatchObject({
    openHour: 10,
    closeHour: 21,
    weekdays: [1, 2, 3, 4, 5, 6],
  });
  const monday = today.plus({ days: 63 }).startOf("week");
  const duration = settings.minimumMinutes;
  const initial = await slots(page, location.id, monday.toISODate()!, duration);
  const initialAvailable = initial.filter((slot) => slot.available);
  expect(initialAvailable.length).toBeGreaterThan(2);
  for (const slot of initialAvailable) {
    expect(
      DateTime.fromISO(slot.startAt).setZone(settings.timezone).hour,
    ).toBeGreaterThanOrEqual(10);
    expect(
      DateTime.fromISO(slot.endAt).setZone(settings.timezone).hour,
    ).toBeLessThanOrEqual(21);
  }
  expect(
    (
      await slots(
        page,
        location.id,
        monday.plus({ days: 6 }).toISODate()!,
        duration,
      )
    ).some((slot) => slot.available),
  ).toBe(false);

  const chosen = initialAvailable[1];
  const localStart = DateTime.fromISO(chosen.startAt).setZone(
    settings.timezone,
  );
  const localEnd = DateTime.fromISO(chosen.endAt).setZone(settings.timezone);
  await page.getByTestId("closure-add").click();
  await page
    .getByTestId("field-startAt")
    .fill(localStart.toFormat("yyyy-MM-dd'T'HH:mm"));
  await page
    .getByTestId("field-endAt")
    .fill(localEnd.toFormat("yyyy-MM-dd'T'HH:mm"));
  await page.getByTestId("field-reason").fill(`Уборка ${stamp}`);
  await mutation(
    page,
    "closure",
    "create",
    page.getByTestId("manage-save"),
    true,
  );
  await expect(
    page.getByText(`Уборка ${stamp}`, { exact: true }),
  ).toBeVisible();
  let resource = (await studio(page)).resources.find(
    (item) => item.id === room.resourceId,
  )!;
  const closure = resource.closures.find(
    (item) => item.reason === `Уборка ${stamp}`,
  )!;
  expect(DateTime.fromISO(closure.startAt).toMillis()).toBe(
    localStart.toMillis(),
  );
  expect(
    (await slots(page, location.id, monday.toISODate()!, duration)).find(
      (slot) => slot.startAt === chosen.startAt,
    )?.available,
  ).toBe(false);
  await page
    .locator("article")
    .filter({ hasText: `Уборка ${stamp}` })
    .getByRole("button", { name: "Изменить закрытие", exact: true })
    .click();
  await page.getByTestId("field-reason").fill(`Подготовка ${stamp}`);
  await page
    .getByTestId("field-endAt")
    .fill(
      localEnd
        .plus({ minutes: settings.stepMinutes })
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    );
  await mutation(
    page,
    "closure",
    "update",
    page.getByTestId("manage-save"),
    true,
  );
  await expect(
    page.getByText(`Подготовка ${stamp}`, { exact: true }),
  ).toBeVisible();
  resource = (await studio(page)).resources.find(
    (item) => item.id === room.resourceId,
  )!;
  expect(resource.closures.find((item) => item.id === closure.id)?.reason).toBe(
    `Подготовка ${stamp}`,
  );
  await mutation(
    page,
    "closure",
    "delete",
    page.getByTestId(`delete-closure-${closure.id}`),
    true,
  );
  await expect(page.getByTestId(`delete-closure-${closure.id}`)).toHaveCount(0);
  expect(
    (await slots(page, location.id, monday.toISODate()!, duration)).find(
      (slot) => slot.startAt === chosen.startAt,
    )?.available,
  ).toBe(true);

  await page.getByTestId("exception-add").click();
  await page.getByTestId("field-date").fill(monday.toISODate()!);
  await page.getByTestId("field-closed").check();
  await mutation(
    page,
    "exception",
    "create",
    page.getByTestId("manage-save"),
    true,
  );
  await expect(
    page.getByText("Закрыто весь день", { exact: true }),
  ).toBeVisible();
  resource = (await studio(page)).resources.find(
    (item) => item.id === room.resourceId,
  )!;
  const exception = resource.exceptions.find(
    (item) => item.date.slice(0, 10) === monday.toISODate(),
  )!;
  expect(exception.closed).toBe(true);
  expect(
    (await slots(page, location.id, monday.toISODate()!, duration)).some(
      (slot) => slot.available,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Изменить особый день", exact: true })
    .click();
  await page.getByTestId("field-closed").uncheck();
  await page.getByTestId("field-openHour").fill("12");
  await page.getByTestId("field-closeHour").fill("16");
  await mutation(
    page,
    "exception",
    "update",
    page.getByTestId("manage-save"),
    true,
  );
  await expect(page.getByText("12:00 — 16:00", { exact: true })).toBeVisible();
  const exceptional = (
    await slots(page, location.id, monday.toISODate()!, duration)
  ).filter((slot) => slot.available);
  expect(exceptional.length).toBeGreaterThan(0);
  expect(exceptional.length).toBeLessThan(initialAvailable.length);
  for (const slot of exceptional) {
    const start = DateTime.fromISO(slot.startAt).setZone(settings.timezone);
    const end = DateTime.fromISO(slot.endAt).setZone(settings.timezone);
    expect(start.hour).toBeGreaterThanOrEqual(12);
    expect(end.hour).toBeLessThanOrEqual(16);
  }
  await mutation(
    page,
    "exception",
    "delete",
    page.getByTestId(`delete-exception-${exception.id}`),
    true,
  );
  await expect(
    page.getByTestId(`delete-exception-${exception.id}`),
  ).toHaveCount(0);
  expect(
    (await slots(page, location.id, monday.toISODate()!, duration)).filter(
      (slot) => slot.available,
    ),
  ).toEqual(initialAvailable);
  resource = (await studio(page)).resources.find(
    (item) => item.id === room.resourceId,
  )!;
  expect(resource.closures).toHaveLength(0);
  expect(resource.exceptions).toHaveLength(0);
  await page.goto("/crm/locations");
  await archive(page, "location", location.id);
  await page.goto("/crm/rooms");
  await archive(page, "room", room.id);
});
