// TEMPORARY: Day 1 benchmark route — delete after benchmarking

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const maxDuration = 10;

export async function GET() {
  const results: Record<string, unknown> = {};
  const overallStart = performance.now();

  // Step 1: Fetch Reddit .json — try multiple URLs
  const fetchUrls = [
    "https://www.reddit.com/r/programming/hot.json?limit=5",
    "https://www.reddit.com/r/AskReddit/comments/t0ynr/.json?limit=100",
  ];

  let commentBodies: string[] = [];

  for (const url of fetchUrls) {
    try {
      const fetchStart = performance.now();
      const resp = await fetch(url, {
        headers: { "User-Agent": "ThreadCartographer/1.0 (benchmark)" },
      });
      const label = url.includes("hot") ? "hot" : "thread";
      results[`fetch_${label}_status`] = resp.status;
      results[`fetch_${label}_ms`] = Math.round(performance.now() - fetchStart);

      if (resp.ok && label === "thread") {
        const data = await resp.json();
        const comments = data[1]?.data?.children ?? [];
        for (const child of comments) {
          const d = child?.data;
          if (child?.kind === "t1" && typeof d?.body_html === "string") {
            commentBodies.push(d.body_html);
          }
        }
        results.commentsExtracted = commentBodies.length;
      }
    } catch (err) {
      results.fetchError = err instanceof Error ? err.message : String(err);
    }
  }

  // Use synthetic HTML if Reddit blocked us
  if (commentBodies.length === 0) {
    const syntheticHtml = '&lt;div class="md"&gt;&lt;p&gt;This is a &lt;strong&gt;test&lt;/strong&gt; with a &lt;a href="https://example.com"&gt;link&lt;/a&gt; and &lt;em&gt;formatting&lt;/em&gt;.&lt;/p&gt;&lt;blockquote&gt;&lt;p&gt;Quoted reply.&lt;/p&gt;&lt;/blockquote&gt;&lt;/div&gt;';
    commentBodies = Array(100).fill(syntheticHtml);
    results.sanitizeSource = "synthetic";
  } else {
    results.sanitizeSource = "live";
  }

  // Step 2: DOMPurify benchmark
  try {
    const { sanitizeHtml } = await import("@/lib/sanitize");
    const count = Math.min(commentBodies.length, 100);
    const sanitizeStart = performance.now();
    for (let i = 0; i < count; i++) {
      await sanitizeHtml(commentBodies[i]);
    }
    const sanitizeMs = performance.now() - sanitizeStart;
    results.sanitizeMs = Math.round(sanitizeMs);
    results.sanitizeCount = count;
    results.sanitizeMsPerComment = Math.round(sanitizeMs / count);
    results.extrapolated500Ms = Math.round((sanitizeMs / count) * 500);
  } catch (err) {
    results.sanitizeError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    results.sanitizeStack = err instanceof Error ? err.stack?.split("\n").slice(0, 3) : undefined;
  }

  // Step 3: Redis
  const client = redis();
  if (client) {
    try {
      const ws = performance.now();
      await client.set("tc:benchmark:test", "ok", { ex: 60 });
      results.redisWriteMs = Math.round(performance.now() - ws);

      const rs = performance.now();
      await client.get("tc:benchmark:test");
      results.redisReadMs = Math.round(performance.now() - rs);
    } catch (err) {
      results.redisError = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.redisError = "No Redis client";
  }

  results.totalMs = Math.round(performance.now() - overallStart);

  // Decision
  const fetchMs = (results.fetch_thread_ms as number) ?? 0;
  const sanitize500 = (results.extrapolated500Ms as number) ?? 0;
  const redisMs = (results.redisWriteMs as number) ?? 0;
  const warmTotal = fetchMs + sanitize500 + redisMs;
  results.estimatedWarmTotal500Ms = warmTotal;

  if (results.sanitizeError) {
    results.recommendation = "FIX_REQUIRED: DOMPurify crashed on Vercel — see sanitizeError";
  } else if (warmTotal < 5000) {
    results.recommendation = "PROCEED: Server-side DOMPurify";
  } else if (warmTotal < 7000) {
    results.recommendation = "SWITCH: Use sanitize-html";
  } else {
    results.recommendation = "MOVE_CLIENT: Sanitize on client side";
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
