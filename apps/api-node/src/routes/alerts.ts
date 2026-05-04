import { Hono } from "hono";

import { parsePublicAlert } from "../lib/redaction.js";

export function alertsRoutes() {
  const app = new Hono();

  app.get("/", (c) => c.json({ alerts: [], next_cursor: null }));

  app.post("/", async (c) => {
    const payload = parsePublicAlert(await c.req.json());
    return c.json({ accepted: true, incident_id: payload.incident_id }, 202);
  });

  return app;
}
