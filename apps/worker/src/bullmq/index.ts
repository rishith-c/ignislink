import { Queue } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";

export const WEBHOOK_FANOUT_QUEUE = "webhook-fanout";

export function createRedisConnection(
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createWebhookFanoutQueue(connection = createRedisConnection()) {
  return new Queue(WEBHOOK_FANOUT_QUEUE, { connection });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = pino({ name: "sentry-max-bullmq" });
  const queue = createWebhookFanoutQueue();
  logger.info({ queue: queue.name }, "bullmq queue booted");
}
