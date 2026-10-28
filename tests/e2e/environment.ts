import "dotenv/config";

const localHosts = ["localhost", "127.0.0.1", "[::1]"];

export function e2eEnvironment() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const base = new URL(baseURL);
  if (
    !localHosts.includes(base.hostname) ||
    base.protocol !== "http:" ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "E2E requires a dedicated local HTTP application URL, for example http://localhost:3100.",
    );
  }
  let databaseURL = process.env.E2E_DATABASE_URL;
  if (!databaseURL && process.env.TEST_DATABASE_URL) {
    const derived = new URL(process.env.TEST_DATABASE_URL);
    derived.pathname = derived.pathname.replace(/_test$/, "_e2e");
    databaseURL = derived.toString();
  }
  if (!databaseURL)
    throw new Error(
      "Set E2E_DATABASE_URL to a separate local database ending in _e2e.",
    );
  const database = new URL(databaseURL);
  if (
    !localHosts.includes(database.hostname) ||
    !/^\/[a-zA-Z0-9_]+_e2e$/.test(database.pathname)
  ) {
    throw new Error(
      "E2E database must be local and its name must end in _e2e.",
    );
  }
  if (
    process.env.TEST_DATABASE_URL &&
    new URL(process.env.TEST_DATABASE_URL).pathname === database.pathname
  ) {
    throw new Error("E2E and integration databases must be separate.");
  }
  const applicationURL =
    process.env.E2E_APPLICATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (
    applicationURL &&
    new URL(applicationURL).pathname === database.pathname
  ) {
    throw new Error(
      "E2E must not target the application database, even if its name ends in _e2e.",
    );
  }
  return {
    baseURL: base.origin,
    databaseURL,
    databaseName: database.pathname.slice(1),
    port: base.port || "80",
  };
}
