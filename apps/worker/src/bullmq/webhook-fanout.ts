import type { JobsOptions } from "bullmq";

import { createWebhookFanoutQueue } from "./index.js";

export type WebhookFanoutJob = {
  webhook_id: string;
  target_url: string;
  body: unknown;
};

export async function enqueueWebhookFanout(
  job: WebhookFanoutJob,
  options: JobsOptions = {},
): Promise<string> {
  const queue = createWebhookFanoutQueue();
  const created = await queue.add("deliver", job, {
    attempts: 5,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 10_000,
    ...options,
  });
  await queue.close();
  return created.id ?? job.webhook_id;
}
