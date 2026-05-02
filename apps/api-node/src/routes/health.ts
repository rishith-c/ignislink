import { collectDefaultMetrics, Registry } from "prom-client";
import { Hono } from "hono";

import { readEnv } from "../env.js";

export function healthRoutes() {
  const app = new Hono();
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "ignislink_api_node_" });

  app.get("/health", (c) => c.json({ status: "ok", service: "@ignislink/api-node" }));

  app.get("/ready", (c) => {
    const env = readEnv();
    return c.json({
      status: env.REDIS_URL ? "ok" : "degraded",
      components: [
        {
          name: "redis",
          status: env.REDIS_URL ? "ok" : "degraded",
          detail: env.REDIS_URL ? "configured" : "REDIS_URL is not configured",
        },
      ],
    });
  });

  app.get("/metrics", async (c) =>
    c.text(await registry.metrics(), 200, {
      "content-type": registry.contentType,
    }),
  );

  return app;
}
