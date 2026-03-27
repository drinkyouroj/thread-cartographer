// Thread data caching via Upstash Redis
// 15-minute TTL, keyed by thread ID
// Fail-open: returns null on Redis errors (does not block requests)

import type { ThreadData } from "./types";
import { redis, recordSuccess, recordFailure, isDegraded } from "./redis";

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes
const KEY_PREFIX = "tc:cache:thread:";

// In-memory counters (reset on cold start)
let hits = 0;
let misses = 0;

export function getCacheStats() {
  return { hits, misses, hitRate: hits + misses > 0 ? hits / (hits + misses) : 0 };
}

/**
 * Normalize a Reddit thread URL to extract the thread ID.
 * Handles: old.reddit, www.reddit, reddit.com, .json suffix,
 * query params, trailing slashes, and comment permalink deep-links.
 */
export function extractThreadId(url: string): string | null {
  try {
    // Strip query params and hash
    let clean = url.split("?")[0].split("#")[0];

    // Remove trailing slashes and .json suffix
    clean = clean.replace(/\/+$/, "").replace(/\.json$/, "").replace(/\/+$/, "");

    // Match Reddit thread URL pattern
    // /r/{subreddit}/comments/{threadId}/...
    const match = clean.match(/\/r\/[^/]+\/comments\/([a-z0-9]+)/i);
    if (!match) return null;

    return match[1];
  } catch {
    return null;
  }
}

function cacheKey(threadId: string): string {
  return `${KEY_PREFIX}${threadId}`;
}

export async function get(threadId: string): Promise<ThreadData | null> {
  const client = redis();
  if (!client || isDegraded()) {
    misses++;
    return null;
  }

  try {
    const data = await client.get<ThreadData>(cacheKey(threadId));
    recordSuccess();
    if (data) {
      hits++;
    } else {
      misses++;
    }
    return data;
  } catch (error) {
    recordFailure(error);
    misses++;
    return null;
  }
}

export async function set(threadId: string, data: ThreadData): Promise<void> {
  const client = redis();
  if (!client || isDegraded()) return;

  try {
    await client.set(cacheKey(threadId), data, { ex: CACHE_TTL_SECONDS });
    recordSuccess();
  } catch (error) {
    recordFailure(error);
    // Fail-open: cache write failure is not fatal
  }
}
