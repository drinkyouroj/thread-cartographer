// Health check endpoint — required per DECISION-002 RC#6
// Public response: only status. Detailed stats require HEALTH_CHECK_TOKEN.

import { NextResponse } from "next/server";
import { ping, isDegraded } from "@/lib/redis";
import { getCacheStats } from "@/lib/cache";

export async function GET(request: Request) {
  const redisOk = await ping();
  const status = redisOk && !isDegraded() ? "healthy" : "degraded";

  // Detailed stats only with auth token (optional, for monitoring)
  const authHeader = request.headers.get("authorization");
  const token = process.env.HEALTH_CHECK_TOKEN;
  const authorized = token && authHeader === `Bearer ${token}`;

  if (authorized) {
    const cacheStats = getCacheStats();
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

  // Public response: status only
  return NextResponse.json({ status });
}
