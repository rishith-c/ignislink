import { describe, expect, it } from "vitest";

import { WEBHOOK_FANOUT_QUEUE } from "../src/bullmq/index.js";

describe("bullmq worker boot constants", () => {
  it("names the webhook fan-out queue", () => {
    expect(WEBHOOK_FANOUT_QUEUE).toBe("webhook-fanout");
  });
});
