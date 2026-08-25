import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";

const serviceHealth = {
  service: "fitness-server",
  status: "ok",
} as const;

const serviceReadiness = {
  checks: {
    http: "ok",
  },
  service: "fitness-server",
  status: "ready",
} as const;

export function registerServiceHealthRoutes(app: Hono<ServerEnv>): void {
  app.get("/healthz", (context) => context.json(serviceHealth));
  app.get("/readyz", (context) => context.json(serviceReadiness));
}
