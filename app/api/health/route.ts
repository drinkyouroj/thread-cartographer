// Health check endpoint — required per DECISION-002 RC#6
// Reports: Redis reachability, cache stats, degraded flag

import { NextResponse } from "next/server";
import { ping, isDegraded } from "@/lib/redis";
import { getCacheStats } from "@/lib/cache";

export async function GET() {
  const redisOk = await ping();
  const cacheStats = getCacheStats();

  const status = redisOk && !isDegraded() ? "healthy" : "degraded";

  return NextResponse.json({
    status,
    redis: {
      reachable: redisOk,
      degraded: isDegraded(),
    },
    cache: cacheStats,
    timestamp: Date.now(),
  });
}
