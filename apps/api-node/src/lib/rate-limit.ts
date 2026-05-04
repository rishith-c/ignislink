export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, nowMs = Date.now()): RateLimitDecision {
    const current = this.buckets.get(key);
    if (!current || current.resetAtMs <= nowMs) {
      const resetAtMs = nowMs + this.windowMs;
      this.buckets.set(key, { count: 1, resetAtMs });
      return { allowed: true, remaining: this.limit - 1, resetAtMs };
    }

    if (current.count >= this.limit) {
      return { allowed: false, remaining: 0, resetAtMs: current.resetAtMs };
    }

    current.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - current.count),
      resetAtMs: current.resetAtMs,
    };
  }
}
