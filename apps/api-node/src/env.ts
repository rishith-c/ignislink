import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  REDIS_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(16).default("dev-webhook-secret-change-me"),
  WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function readEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return EnvSchema.parse(input);
}
