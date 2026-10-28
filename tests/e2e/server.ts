import { PrismaClient } from "@prisma/client";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { e2eEnvironment } from "./environment";

async function main() {
  const target = e2eEnvironment();
  const administrativeURL = new URL(target.databaseURL);
  administrativeURL.pathname = "/postgres";
  const admin = new PrismaClient({
    datasourceUrl: administrativeURL.toString(),
  });
  try {
    const exists = await admin.$queryRaw<
      { datname: string }[]
    >`SELECT datname FROM pg_database WHERE datname = ${target.databaseName}`;
    if (!exists.length) {
      // The identifier is validated against an ASCII-only _e2e suffix above.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${target.databaseName}"`);
    }
  } finally {
    await admin.$disconnect();
  }
  const env = {
    ...process.env,
    DATABASE_URL: target.databaseURL,
    BETTER_AUTH_URL: target.baseURL,
    PAYMENT_MODE: "test",
  };
  for (const args of [
    [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    [resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error("Preparing the isolated E2E database failed.");
  }
  console.log(
    `Starting the E2E application on ${target.baseURL}; database ${target.databaseName}.`,
  );
  const server = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      target.port,
    ],
    {
      env: { ...env, NODE_ENV: "production" },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const stop = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("exit", stop);
  server.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.once("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "E2E server failed.");
  process.exitCode = 1;
});
