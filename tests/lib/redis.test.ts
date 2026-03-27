import { describe, it, expect, beforeEach } from "vitest";
import {
  isDegraded,
  isAvailable,
  recordSuccess,
  recordFailure,
} from "@/lib/redis";

// Reset module state between tests by calling recordSuccess until clean
function resetState() {
  // recordSuccess resets consecutiveFailures to 0 and degraded to false
  recordSuccess();
}

describe("redis failure detection", () => {
  beforeEach(() => {
    resetState();
  });

  it("starts in non-degraded state", () => {
    expect(isDegraded()).toBe(false);
  });

  it("does not degrade after 1 failure", () => {
    recordFailure(new Error("test"));
    expect(isDegraded()).toBe(false);
  });

  it("does not degrade after 2 failures", () => {
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));
    expect(isDegraded()).toBe(false);
  });

  it("degrades after 3 consecutive failures", () => {
    recordFailure(new Error("test 1"));
    recordFailure(new Error("test 2"));
    recordFailure(new Error("test 3"));
    expect(isDegraded()).toBe(true);
  });

  it("recovers from degraded state on success", () => {
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));
    expect(isDegraded()).toBe(true);

    recordSuccess();
    expect(isDegraded()).toBe(false);
  });

  it("resets failure count on success", () => {
    recordFailure(new Error("test"));
    recordFailure(new Error("test"));
    // 2 failures, then a success resets the counter
    recordSuccess();
    // Now 1 more failure should NOT degrade (counter was reset)
    recordFailure(new Error("test"));
    expect(isDegraded()).toBe(false);
  });

  it("handles non-Error objects in recordFailure", () => {
    recordFailure("string error");
    recordFailure(42);
    recordFailure(null);
    expect(isDegraded()).toBe(true); // 3 failures
  });
});

describe("isAvailable", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns false when no env vars are set", () => {
    // In test environment, UPSTASH_REDIS_REST_URL is not set
    // so the Redis client is null, making it unavailable
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    // Need a fresh import to test with no env vars
    // Since the client is cached, isAvailable checks both client and degraded
    // With no env vars and no cached client, it returns false
    expect(isAvailable()).toBe(false);

    // Restore
    if (originalUrl) process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken) process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  });
});
