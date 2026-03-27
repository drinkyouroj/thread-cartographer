import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns JSON with status field", async () => {
    const request = new Request("http://localhost:3000/api/health");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("status");
    expect(["healthy", "degraded"]).toContain(data.status);
  });

  it("does not expose detailed stats without auth token", async () => {
    const request = new Request("http://localhost:3000/api/health");
    const response = await GET(request);
    const data = await response.json();

    expect(data).not.toHaveProperty("redis");
    expect(data).not.toHaveProperty("cache");
    expect(data).not.toHaveProperty("timestamp");
  });

  it("exposes detailed stats with valid auth token", async () => {
    const originalToken = process.env.HEALTH_CHECK_TOKEN;
    process.env.HEALTH_CHECK_TOKEN = "test-secret";

    const request = new Request("http://localhost:3000/api/health", {
      headers: { authorization: "Bearer test-secret" },
    });
    const response = await GET(request);
    const data = await response.json();

    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("redis");
    expect(data).toHaveProperty("cache");
    expect(data).toHaveProperty("timestamp");
    expect(data.redis).toHaveProperty("reachable");
    expect(data.redis).toHaveProperty("degraded");
    expect(data.cache).toHaveProperty("hits");
    expect(data.cache).toHaveProperty("misses");

    // Restore
    if (originalToken) {
      process.env.HEALTH_CHECK_TOKEN = originalToken;
    } else {
      delete process.env.HEALTH_CHECK_TOKEN;
    }
  });

  it("does not expose detailed stats with wrong token", async () => {
    const originalToken = process.env.HEALTH_CHECK_TOKEN;
    process.env.HEALTH_CHECK_TOKEN = "correct-token";

    const request = new Request("http://localhost:3000/api/health", {
      headers: { authorization: "Bearer wrong-token" },
    });
    const response = await GET(request);
    const data = await response.json();

    expect(data).not.toHaveProperty("redis");
    expect(data).not.toHaveProperty("cache");

    if (originalToken) {
      process.env.HEALTH_CHECK_TOKEN = originalToken;
    } else {
      delete process.env.HEALTH_CHECK_TOKEN;
    }
  });
});
