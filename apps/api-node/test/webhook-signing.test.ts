import { describe, expect, it } from "vitest";

import { signWebhookBody, verifyWebhookSignature } from "../src/lib/signing.js";

describe("webhook signing", () => {
  it("accepts a valid HMAC signature", () => {
    const secret = "test-secret-with-enough-length";
    const body = JSON.stringify({ event: "dispatch.created" });
    const signed = signWebhookBody(secret, body, 1_777_700_000);

    expect(
      verifyWebhookSignature({
        secret,
        body,
        header: signed.header,
        nowSeconds: 1_777_700_100,
      }),
    ).toBe(true);
  });

  it("rejects replayed signatures outside the window", () => {
    const secret = "test-secret-with-enough-length";
    const body = JSON.stringify({ event: "dispatch.created" });
    const signed = signWebhookBody(secret, body, 1_777_700_000);

    expect(
      verifyWebhookSignature({
        secret,
        body,
        header: signed.header,
        nowSeconds: 1_777_700_500,
        replayWindowSeconds: 300,
      }),
    ).toBe(false);
  });
});
