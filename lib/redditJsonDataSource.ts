// RedditJsonDataSource — implements DataSource for the Reddit .json endpoint
// Architecture: client-side fetch, server-side processing
// The client fetches Reddit .json from the browser (Reddit blocks Vercel IPs),
// then POSTs the raw JSON here for parsing, scoring, sanitizing, and caching.

import type { DataSource } from "./dataSource";
import type { ThreadData } from "./types";
import { parseRedditResponse, validateRedditJson } from "./redditParser";
import { extractThreadId, get as cacheGet, set as cacheSet } from "./cache";
import { ValidationError } from "./errors";

// URL validation regex: matches reddit.com/r/*/comments/* patterns
const REDDIT_THREAD_URL_REGEX =
  /^https?:\/\/(?:www\.|old\.|new\.|np\.)?reddit\.com\/r\/[a-zA-Z0-9_]+\/comments\/[a-z0-9]+/i;

// Short URL pattern to give a helpful error
const REDDIT_SHORT_URL_REGEX = /^https?:\/\/redd\.it\//i;

export class RedditJsonDataSource implements DataSource {
  isValidUrl(url: string): boolean {
    return REDDIT_THREAD_URL_REGEX.test(url);
  }

  /**
   * Check the cache for a previously processed thread.
   * Returns cached ThreadData or null.
   */
  async checkCache(url: string): Promise<ThreadData | null> {
    const threadId = extractThreadId(url);
    if (!threadId) return null;
    return cacheGet(threadId);
  }

  /**
   * Process raw Reddit JSON submitted by the client.
   * Parses, scores sentiment, sanitizes HTML, and caches the result.
   */
  async processRawJson(url: string, rawJson: unknown): Promise<ThreadData> {
    // Validate URL
    if (REDDIT_SHORT_URL_REGEX.test(url)) {
      throw new ValidationError(
        "Please use the full Reddit thread URL, not a redd.it short link.",
        "SHORT_URL"
      );
    }

    if (!this.isValidUrl(url)) {
      throw new ValidationError(
        "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)"
      );
    }

    // Validate the raw JSON structure
    const validationError = validateRedditJson(rawJson);
    if (validationError) {
      throw new ValidationError(
        `Invalid Reddit data: ${validationError}`,
        "INVALID_DATA"
      );
    }

    // Verify the submitted data matches the claimed URL
    const threadId = extractThreadId(url);
    if (!threadId) {
      throw new ValidationError("Could not extract thread ID from URL");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postData = (rawJson as any)[0]?.data?.children?.[0]?.data;
    const dataThreadId = postData?.id ?? (postData?.name?.replace(/^t3_/, "") || "");
    if (!dataThreadId || dataThreadId !== threadId) {
      throw new ValidationError(
        "Submitted data does not match the claimed URL",
        "DATA_URL_MISMATCH"
      );
    }

    // Parse, score, sanitize
    const threadData = parseRedditResponse(rawJson);

    // Cache the result
    await cacheSet(threadId, threadData);

    return threadData;
  }

  /**
   * Full fetch+process flow — not used in client-side fetch architecture.
   * Kept for DataSource interface compliance and potential future server-side fetch.
   */
  async fetchThread(url: string): Promise<ThreadData> {
    // Check cache first
    const cached = await this.checkCache(url);
    if (cached) return cached;

    // In client-side fetch architecture, the server cannot fetch from Reddit.
    // This method exists for interface compliance. Use processRawJson() instead.
    throw new Error(
      "Server-side Reddit fetch is not available (Reddit blocks Vercel IPs). " +
        "Use the two-phase API: GET /api/thread for cache check, POST /api/thread with raw JSON."
    );
  }
}
