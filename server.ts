import { Hono } from "hono";
import { createApp } from "./apps/server/src/app.js";
import { createPersistenceServices } from "./apps/server/src/persistence.js";

const app = new Hono();
app.route(
  "/",
  createApp({
    services: createPersistenceServices(),
  }),
);

export default app;
