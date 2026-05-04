import { Hono } from "hono";

import { readEnv } from "../env.js";
import { verifyWebhookSignature } from "../lib/signing.js";

export function webhooksRoutes() {
  const app = new Hono();

  app.post("/dispatch", async (c) => {
    const env = readEnv();
    const body = await c.req.text();
    const verified = verifyWebhookSignature({
      secret: env.WEBHOOK_SECRET,
      body,
      header: c.req.header("x-ignislink-signature") ?? null,
      replayWindowSeconds: env.WEBHOOK_REPLAY_WINDOW_SECONDS,
    });

    if (!verified) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    return c.json({ accepted: true }, 202);
  });

  return app;
}
