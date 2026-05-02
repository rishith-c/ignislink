import { describe, expect, it } from "vitest";

import { createApp } from "../src/index.js";

describe("api-node health routes", () => {
  it("returns liveness", async () => {
    const response = await createApp().request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "@ignislink/api-node",
    });
  });

  it("exposes prometheus metrics", async () => {
    const response = await createApp().request("/metrics");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ignislink_api_node_process_cpu_user_seconds_total");
  });
});
