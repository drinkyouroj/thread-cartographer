// Per-IP rate limiting via @upstash/ratelimit sliding window
// 10 requests per 60 seconds per IP
// Fail-open: allows request through on Redis errors

import { Ratelimit } from "@upstash/ratelimit";
import { redis, recordSuccess, recordFailure, isDegraded } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds until next allowed request (0 if allowed)
}

let limiter: Ratelimit | null = null;
let limiterDegraded = false;

function getLimiter(): Ratelimit | null {
  // Reset cached limiter if Redis recovered from degraded state
  if (limiter && limiterDegraded && !isDegraded()) {
    limiter = null;
    limiterDegraded = false;
  }

  if (limiter) return limiter;

  const client = redis();
  if (!client) return null;

  limiterDegraded = isDegraded();
  limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "tc:ratelimit",
  });

  return limiter;
}

export async function checkLimit(ip: string): Promise<RateLimitResult> {
  if (isDegraded()) {
    // Fail-open: allow request when Redis is degraded
    return { allowed: true, retryAfter: 0 };
  }

  const rl = getLimiter();
  if (!rl) {
    // No Redis configured: allow all requests (local dev / CI)
    return { allowed: true, retryAfter: 0 };
  }

  try {
    const result = await rl.limit(ip);
    recordSuccess();

    if (result.success) {
      return { allowed: true, retryAfter: 0 };
    }

    const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(retryAfter, 1),
    };
  } catch (error) {
    recordFailure(error);
    // Fail-open: allow request on rate limiter error
    return { allowed: true, retryAfter: 0 };
  }
}
