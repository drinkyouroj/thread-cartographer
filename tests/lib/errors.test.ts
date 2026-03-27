import { describe, it, expect } from "vitest";
import {
  ValidationError,
  RateLimitError,
  RedditApiError,
  UpstreamError,
} from "@/lib/errors";

describe("ValidationError", () => {
  it("maps to 400 status", () => {
    const err = new ValidationError("Invalid URL");
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(400);
    expect(resp.body.error).toBe("INVALID_URL");
  });

  it("supports custom error codes", () => {
    const err = new ValidationError("Use full URL", "SHORT_URL");
    expect(err.toHttpResponse().body.error).toBe("SHORT_URL");
  });
});

describe("RateLimitError", () => {
  it("maps to 429 status with retryAfter", () => {
    const err = new RateLimitError(30);
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(429);
    expect(resp.body.retryAfter).toBe(30);
  });
});

describe("RedditApiError", () => {
  it("maps 403 to 502 THREAD_INACCESSIBLE", () => {
    const err = new RedditApiError(403);
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(502);
    expect(resp.body.error).toBe("THREAD_INACCESSIBLE");
  });

  it("maps 451 to 502 THREAD_INACCESSIBLE", () => {
    const err = new RedditApiError(451);
    expect(err.toHttpResponse().body.error).toBe("THREAD_INACCESSIBLE");
  });

  it("maps 429 to 503 REDDIT_RATE_LIMITED", () => {
    const err = new RedditApiError(429);
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(503);
    expect(resp.body.error).toBe("REDDIT_RATE_LIMITED");
  });

  it("maps 500 to 502 REDDIT_UNAVAILABLE", () => {
    const err = new RedditApiError(500);
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(502);
    expect(resp.body.error).toBe("REDDIT_UNAVAILABLE");
  });
});

describe("UpstreamError", () => {
  it("maps to 504 TIMEOUT", () => {
    const err = new UpstreamError();
    const resp = err.toHttpResponse();
    expect(resp.status).toBe(504);
    expect(resp.body.error).toBe("TIMEOUT");
  });
});
