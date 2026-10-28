import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { e2eEnvironment } from "./tests/e2e/environment";

const { baseURL, databaseURL } = e2eEnvironment();
process.env.E2E_APPLICATION_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.E2E_DATABASE_URL = databaseURL;
process.env.DATABASE_URL = databaseURL;
process.env.E2E_BASE_URL = baseURL;
process.env.BETTER_AUTH_URL = baseURL;
process.env.E2E_CREATE_STAFF_FIXTURE ??= "1";
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
  webServer: {
    command: "pnpm exec tsx tests/e2e/server.ts",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
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
