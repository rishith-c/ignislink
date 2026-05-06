import { serve } from "@hono/node-server";
import { Hono } from "hono";
import pino from "pino";

import { readEnv } from "./env.js";
import { alertsRoutes } from "./routes/alerts.js";
import { healthRoutes } from "./routes/health.js";
import { webhooksRoutes } from "./routes/webhooks.js";

export function createApp() {
  const app = new Hono();
  app.route("/", healthRoutes());
  app.route("/alerts", alertsRoutes());
  app.route("/webhooks", webhooksRoutes());
  return app;
}

export const app = createApp();

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = readEnv();
  const logger = pino({ name: "sentry-max-api-node" });
  serve({ fetch: app.fetch, port: env.PORT });
  logger.info({ port: env.PORT }, "api-node listening");
}
