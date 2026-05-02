import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSignature = {
  timestamp: number;
  signature: string;
  header: string;
};

export type VerifyWebhookInput = {
  secret: string;
  body: string;
  header: string | null;
  nowSeconds?: number;
  replayWindowSeconds?: number;
};

export function signWebhookBody(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): WebhookSignature {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    timestamp,
    signature,
    header: `t=${timestamp},v1=${signature}`,
  };
}

export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  if (!input.header) return false;

  const parts = Object.fromEntries(
    input.header.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const replayWindowSeconds = input.replayWindowSeconds ?? 300;
  if (Math.abs(nowSeconds - timestamp) > replayWindowSeconds) return false;

  const expected = signWebhookBody(input.secret, input.body, timestamp).signature;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(signature, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
