import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { createPersistenceServices } from "./persistence.js";

const port = Number(envValue("PORT") ?? "3000");
const hostname = envValue("HOST") ?? "0.0.0.0";

try {
  const app = createApp({
    services: createPersistenceServices(),
  });
  const server = serve(
    {
      fetch: app.fetch,
      hostname,
      port,
    },
    logServerStart,
  );

  server.on("error", (error: Error) => {
    console.error("[startup] server error", {
      message: error.message,
      name: error.name,
    });
    process.exitCode = 1;
  });
} catch (error) {
  console.error("[startup] failed to initialize server", serializeError(error));
  process.exitCode = 1;
}

function logServerStart(info: AddressInfo): void {
  console.log("[startup] fitness-server listening", {
    address: info.address,
    family: info.family,
    port: info.port,
    persistence: envValue("FITNESS_PERSISTENCE") ?? "memory",
  });
}

function serializeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
    name: typeof error,
  };
}

function envValue(name: string): string | undefined {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env?.[name];
}
