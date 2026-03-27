import { describe, it, expect, beforeEach } from "vitest";
import { checkLimit } from "@/lib/rateLimiter";
import { recordSuccess, recordFailure } from "@/lib/redis";

function resetState() {
  recordSuccess();
}

describe("checkLimit", () => {
  beforeEach(() => {
    resetState();
  });

  it("allows requests when Redis is not configured", async () => {
    // In test environment, no Redis env vars are set
    const result = await checkLimit("127.0.0.1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBe(0);
  });

  it("allows requests when Redis is degraded (fail-open)", async () => {
    // Force degraded state
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));

    const result = await checkLimit("127.0.0.1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBe(0);
  });

  it("returns consistent shape for allowed requests", async () => {
    const result = await checkLimit("192.168.1.1");
    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("retryAfter");
    expect(typeof result.allowed).toBe("boolean");
    expect(typeof result.retryAfter).toBe("number");
  });
});
