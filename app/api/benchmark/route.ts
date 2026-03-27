// TEMPORARY: Day 1 benchmark route — delete after benchmarking
// Tests: Reddit fetch latency, DOMPurify sanitization throughput, Redis write latency
// Per BUILD_PLAN_FULL_v2 Section 3, Week 1 Day 1 Benchmark Protocol

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { sanitizeHtml } from "@/lib/sanitize";

export const maxDuration = 10;

export async function GET() {
  const results: Record<string, unknown> = {};
  const overallStart = performance.now();

  // Step 1: Fetch Reddit .json
  const fetchStart = performance.now();
  let commentBodies: string[] = [];
  try {
    const resp = await fetch(
      "https://www.reddit.com/r/AskReddit/comments/t0ynr/.json?limit=200",
      {
        headers: { "User-Agent": "ThreadCartographer/1.0 (benchmark)" },
      }
    );
    if (!resp.ok) {
      results.fetchError = `Reddit returned ${resp.status}`;
    } else {
      const data = await resp.json();
      const fetchEnd = performance.now();
      results.fetchMs = Math.round(fetchEnd - fetchStart);

      // Extract comment body_html strings
      const comments = data[1]?.data?.children ?? [];
      function extractBodies(children: Array<Record<string, unknown>>) {
        for (const child of children) {
          const d = child.data as Record<string, unknown> | undefined;
          if (!d) continue;
          if (child.kind === "t1" && typeof d.body_html === "string") {
            commentBodies.push(d.body_html);
          }
          if (d.replies && typeof d.replies === "object") {
            const replies = d.replies as Record<string, unknown>;
            const replyData = replies.data as Record<string, unknown> | undefined;
            if (replyData?.children) {
              extractBodies(replyData.children as Array<Record<string, unknown>>);
            }
          }
        }
      }
      extractBodies(comments);
      results.commentsExtracted = commentBodies.length;
    }
  } catch (err) {
    results.fetchError = err instanceof Error ? err.message : String(err);
  }

  // Step 2: Sanitize comments with DOMPurify
  if (commentBodies.length > 0) {
    const target = Math.min(commentBodies.length, 100);
    const sanitizeStart = performance.now();
    for (let i = 0; i < target; i++) {
      await sanitizeHtml(commentBodies[i]);
    }
    const sanitizeEnd = performance.now();
    results.sanitizeMs = Math.round(sanitizeEnd - sanitizeStart);
    results.sanitizeCount = target;
    results.sanitizeMsPerComment = Math.round(
      (sanitizeEnd - sanitizeStart) / target
    );

    // Extrapolate for 500 comments
    results.extrapolated500Ms = Math.round(
      ((sanitizeEnd - sanitizeStart) / target) * 500
    );
  }

  // Step 3: Redis write
  const client = redis();
  if (client) {
    const redisStart = performance.now();
    try {
      await client.set("tc:benchmark:test", "ok", { ex: 60 });
      const writeEnd = performance.now();
      results.redisWriteMs = Math.round(writeEnd - redisStart);

      const readStart = performance.now();
      await client.get("tc:benchmark:test");
      const readEnd = performance.now();
      results.redisReadMs = Math.round(readEnd - readStart);
    } catch (err) {
      results.redisError = err instanceof Error ? err.message : String(err);
    }
  } else {
    results.redisError = "No Redis client (env vars missing)";
  }

  const overallEnd = performance.now();
  results.totalMs = Math.round(overallEnd - overallStart);

  // Decision matrix
  const warmTotal =
    (results.fetchMs as number ?? 0) +
    (results.extrapolated500Ms as number ?? 0) +
    (results.redisWriteMs as number ?? 0);
  results.estimatedWarmTotal500Ms = warmTotal;

  if (warmTotal < 5000) {
    results.recommendation = "PROCEED: Server-side DOMPurify, cache fully-processed ThreadData";
  } else if (warmTotal < 7000) {
    results.recommendation = "SWITCH: Use sanitize-html instead of isomorphic-dompurify";
  } else {
    results.recommendation = "MOVE_CLIENT: Sanitize on client side, cache unsanitized data";
  }

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
