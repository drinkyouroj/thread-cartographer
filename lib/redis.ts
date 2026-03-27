// Singleton Upstash Redis client with failure detection
// Per DECISION-002 Required Change #6: failure counter + isDegraded()

import { Redis } from "@upstash/redis";

const MAX_CONSECUTIVE_FAILURES = 3;

let client: Redis | null = null;
let consecutiveFailures = 0;
let degraded = false;

function getClient(): Redis | null {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  client = new Redis({ url, token });
  return client;
}

export function isDegraded(): boolean {
  return degraded;
}

export function isAvailable(): boolean {
  return getClient() !== null && !degraded;
}

export function recordSuccess(): void {
  consecutiveFailures = 0;
  if (degraded) {
    degraded = false;
    console.log(
      JSON.stringify({ event: "redis_recovered", consecutiveFailures: 0 })
    );
  }
}

export function recordFailure(error: unknown): void {
  consecutiveFailures++;
  const wasHealthy = !degraded;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    degraded = true;
  }
  console.error(
    JSON.stringify({
      event: "redis_error",
      consecutiveFailures,
      degraded,
      error: error instanceof Error ? error.message : String(error),
    })
  );
  if (degraded && wasHealthy) {
    console.error(
      JSON.stringify({
        event: "redis_degraded",
        message: `Redis marked degraded after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
      })
    );
  }
}

export async function ping(): Promise<boolean> {
  const redis = getClient();
  if (!redis) return false;

  try {
    const result = await redis.ping();
    recordSuccess();
    return result === "PONG";
  } catch (error) {
    recordFailure(error);
    return false;
  }
}

export function redis(): Redis | null {
  return getClient();
}
