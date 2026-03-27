// Two-phase thread API route
// GET  /api/thread?url={encoded_url} — check cache, return ThreadData if cached
// POST /api/thread { url, redditData } — process raw Reddit JSON, cache, return ThreadData
//
// Architecture: Reddit fetch happens client-side (Reddit blocks Vercel IPs).
// Server handles: validation, rate limiting, parsing, sentiment, sanitization, caching.

import { NextRequest, NextResponse } from "next/server";
import { RedditJsonDataSource } from "@/lib/redditJsonDataSource";
import { checkLimit } from "@/lib/rateLimiter";
import { extractThreadId } from "@/lib/cache";
import { isDegraded } from "@/lib/redis";
import { normalizeRedditUrl } from "@/lib/redditParser";
import { AppError, ValidationError, RateLimitError } from "@/lib/errors";

const dataSource = new RedditJsonDataSource();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

function logRequest(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * GET /api/thread?url={encoded_url}
 * Check cache for a previously processed thread.
 * Returns ThreadData if cached, 404 if not.
 * Does not count toward rate limit (cache checks are free).
 */
export async function GET(request: NextRequest) {
  const start = performance.now();
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "MISSING_URL", message: "The 'url' query parameter is required." },
      { status: 400 }
    );
  }

  if (!dataSource.isValidUrl(url)) {
    const isShortUrl = /^https?:\/\/redd\.it\//i.test(url);
    return NextResponse.json(
      {
        error: isShortUrl ? "SHORT_URL" : "INVALID_URL",
        message: isShortUrl
          ? "Please use the full Reddit thread URL, not a redd.it short link."
          : "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)",
      },
      { status: 400 }
    );
  }

  const threadId = extractThreadId(url);
  if (!threadId) {
    return NextResponse.json(
      { error: "INVALID_URL", message: "Could not extract thread ID from URL." },
      { status: 400 }
    );
  }

  const cached = await dataSource.checkCache(url);
  const duration = Math.round(performance.now() - start);

  if (cached) {
    logRequest("cache_hit", { threadId, duration });

    const headers: HeadersInit = { "X-Cache": "HIT" };
    if (isDegraded()) headers["X-Degraded"] = "cache";

    return NextResponse.json(
      {
        data: cached,
        meta: { cached: true, fetchedAt: cached.fetchedAt, degraded: isDegraded() },
      },
      { headers }
    );
  }

  // Return normalized URL so client fetches the full thread (not a comment subtree)
  const normalizedUrl = normalizeRedditUrl(url);
  const fetchUrl = `${normalizedUrl}.json`;

  logRequest("cache_miss", { threadId, duration });
  return NextResponse.json(
    { data: null, meta: { cached: false, threadId, fetchUrl } },
    { status: 404, headers: { "X-Cache": "MISS" } }
  );
}

/**
 * POST /api/thread { url: string, redditData: object }
 * Process raw Reddit JSON submitted by the client.
 * Rate-limited. Validates, parses, scores, sanitizes, caches.
 */
export async function POST(request: NextRequest) {
  const start = performance.now();
  const ip = getClientIp(request);

  // Rate limit
  const rateResult = await checkLimit(ip);
  if (!rateResult.allowed) {
    logRequest("rate_limited", { ip, retryAfter: rateResult.retryAfter });
    const err = new RateLimitError(rateResult.retryAfter);
    const resp = err.toHttpResponse();
    return NextResponse.json(resp.body, {
      status: resp.status,
      headers: { "Retry-After": String(rateResult.retryAfter) },
    });
  }

  // Check body size (Vercel Hobby limit: 4.5MB; we cap at 5MB)
  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 5 MB limit." },
      { status: 413 }
    );
  }

  // Parse request body
  let body: { url?: string; redditData?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { url, redditData } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "MISSING_URL", message: "The 'url' field is required." },
      { status: 400 }
    );
  }

  if (!redditData) {
    return NextResponse.json(
      { error: "MISSING_DATA", message: "The 'redditData' field is required." },
      { status: 400 }
    );
  }

  try {
    const threadData = await dataSource.processRawJson(url, redditData);
    const duration = Math.round(performance.now() - start);

    logRequest("thread_processed", {
      threadId: threadData.threadId,
      nodeCount: threadData.nodes.length,
      isTruncated: threadData.isTruncated,
      duration,
      cacheHit: false,
      degraded: isDegraded(),
    });

    const headers: HeadersInit = {};
    if (isDegraded()) headers["X-Degraded"] = "cache";

    return NextResponse.json(
      {
        data: threadData,
        meta: {
          cached: false,
          fetchedAt: threadData.fetchedAt,
          degraded: isDegraded(),
        },
      },
      { headers }
    );
  } catch (error) {
    const duration = Math.round(performance.now() - start);

    if (error instanceof AppError) {
      logRequest("thread_error", {
        code: error.code,
        statusCode: error.statusCode,
        duration,
      });
      const resp = error.toHttpResponse();
      return NextResponse.json(resp.body, { status: resp.status });
    }

    logRequest("thread_error", {
      code: "INTERNAL",
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    return NextResponse.json(
      { error: "INTERNAL", message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
