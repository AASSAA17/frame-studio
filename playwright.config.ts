import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.E2E_BASE_URL ??
  process.env.BETTER_AUTH_URL ??
  "http://localhost:3000";
const channel =
  process.env.E2E_BROWSER_CHANNEL ??
  (process.platform === "win32" ? "chrome" : undefined);
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error(
    "E2E tests create bookings and test payments. Use a local, disposable application instance.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
      },
    },
  ],
});
