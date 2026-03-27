# Backend / API Implementation Plan

**Project:** Thread Cartographer
**Author:** Backend/API Engineer
**Date:** 2026-03-26
**PRD Reference:** `docs/decisions/DECISION-001-thread-cartographer-prd.md`

This plan covers all server-side and data-layer work for Phase 1. It is ordered by dependency -- infrastructure first, then data logic, then the API route that ties everything together.

---

## 1. DataSource Interface Implementation

### What to build

Define the `DataSource` interface and the concrete `RedditJsonDataSource` class. Also provide a `FixtureDataSource` for deterministic testing.

### Files

| File | Action |
|------|--------|
| `lib/types.ts` | Create. `CommentNode`, `ThreadEdge`, `ThreadData` types exactly as specified in PRD SS4.4. |
| `lib/dataSource.ts` | Create. `DataSource` interface with `fetchThread(url: string): Promise<ThreadData>` and `isValidUrl(url: string): boolean`. |
| `lib/redditJsonDataSource.ts` | Create. Implements `DataSource`. Delegates to cache, fetch, parse, sanitize, and sentiment modules. |
| `tests/lib/fixtureDataSource.ts` | Create. Implements `DataSource` backed by static JSON files for testing. |
| `tests/fixtures/` | Create directory. Contains at least two captured Reddit `.json` responses: one small thread (less than 500 comments) and one large thread (greater than 500 comments, pre-truncated). |

### Key decisions

- **Constructor injection for cache and rate limiter.** `RedditJsonDataSource` accepts `cache` and `rateLimiter` as constructor arguments so they can be stubbed in tests. The production instance is wired up in the API route module.
- **`FixtureDataSource` is not a mock.** It reads real captured Reddit JSON and runs it through the same parse/normalize pipeline. This validates the parser against actual Reddit response shapes.
- **Single responsibility.** `RedditJsonDataSource.fetchThread()` orchestrates: validate URL, check cache, fetch if miss, parse, score sentiment, sanitize HTML, write cache, return. Each step is a separate importable function so it can be unit-tested independently.

### Estimated effort

4 hours for types + interface + fixture data source. `RedditJsonDataSource` is estimated separately below since it depends on all other modules.

### Dependencies

- Needs cache module (section 5) and rate limiter (section 4) interfaces defined, but not fully implemented, to define the constructor signature.

---

## 2. API Route (`/api/thread`)

### What to build

A Next.js App Router API route that is the single entry point for all thread data requests. Handles validation, rate limiting, delegation to `DataSource`, and error mapping.

### Files

| File | Action |
|------|--------|
| `app/api/thread/route.ts` | Create. Exports `GET` handler. |
| `tests/api/thread/route.test.ts` | Create. Integration tests against the route handler using Next.js test utilities. |

### Request contract

```
GET /api/thread?url={encoded_reddit_url}
```

### URL allowlisting regex

```typescript
const REDDIT_THREAD_RE = /^https?:\/\/(www\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9]+/;
```

This pattern accepts any `reddit.com/r/{subreddit}/comments/{id}` URL with or without trailing path segments (title slug, query params). Reject everything else with 400.

Validation steps in order:
1. Check `url` query param exists (400 if missing).
2. Decode and validate against `REDDIT_THREAD_RE` (400 if no match).
3. Check per-IP rate limit (429 if exceeded).
4. Delegate to `dataSource.fetchThread(url)`.
5. Return `ThreadData` JSON with 200.

### Response shape

**200 OK:**
```json
{
  "data": { /* ThreadData */ },
  "meta": {
    "cached": true,
    "fetchedAt": 1711500000,
    "ttlRemaining": 842
  }
}
```

**400 Bad Request:**
```json
{ "error": "Invalid or disallowed URL", "code": "INVALID_URL" }
```

**429 Too Many Requests:**
Headers: `Retry-After: <seconds>`
```json
{ "error": "Rate limit exceeded", "code": "RATE_LIMITED", "retryAfter": 23 }
```

**500 Internal Server Error:**
```json
{ "error": "Internal server error", "code": "INTERNAL_ERROR" }
```

**502 Bad Gateway:**
```json
{ "error": "Reddit API unavailable", "code": "UPSTREAM_ERROR" }
```

### Key decisions

- **GET, not POST.** Thread fetching is idempotent and cacheable. GET aligns with HTTP semantics and allows CDN/browser caching later.
- **IP extraction.** Use `x-forwarded-for` header (Vercel sets this). Fall back to `x-real-ip`. If neither exists, use a constant string (localhost dev).
- **No streaming.** The response is a single JSON payload. Reddit responses for 500 comments are typically 200-500 KB parsed, well within comfortable response sizes.
- **Error codes are stable strings.** Frontend can switch on `code` field rather than parsing human-readable messages.

### Estimated effort

6 hours (route + tests + error handling matrix).

### Dependencies

- Rate limiter (section 4).
- `RedditJsonDataSource` fully wired (section 1 + section 3).

---

## 3. Reddit `.json` Fetch Logic

### What to build

The core fetch-and-parse pipeline that turns a Reddit thread URL into normalized `CommentNode[]` + `ThreadEdge[]`.

### Files

| File | Action |
|------|--------|
| `lib/redditFetch.ts` | Create. `fetchRedditJson(url: string): Promise<RedditRawResponse>` -- handles HTTP request, retries, User-Agent. |
| `lib/redditParser.ts` | Create. `parseRedditResponse(raw: RedditRawResponse): { nodes: CommentNode[], edges: ThreadEdge[], threadMeta: Partial<ThreadData> }` |
| `tests/lib/redditFetch.test.ts` | Create. Tests with mocked HTTP (using `msw` or `vi.fn()`). |
| `tests/lib/redditParser.test.ts` | Create. Tests against fixture JSON files. |

### Reddit `.json` response structure

Reddit returns a two-element array:
- `[0]` -- the post listing (kind `"Listing"`, contains the thread/post data).
- `[1]` -- the comment listing (kind `"Listing"`, contains the comment tree).

Each comment is `{ kind: "t1", data: { ... } }`. Replies are nested under `data.replies` as another `Listing`. The tree terminates with either `null` replies or `{ kind: "more", data: { children: [...ids], count: N } }` objects.

### Parse algorithm

```
function parseCommentTree(listing, parentId, depth, state):
  for each child in listing.data.children:
    if child.kind === "more":
      create stub CommentNode with isStub=true, childCount=child.data.count
      add edge from parentId to stub
      continue

    if child.kind === "t1":
      if state.nodeCount >= 500:
        create stub node representing truncation
        add edge
        set state.isTruncated = true
        return

      create CommentNode from child.data
      add edge from parentId to node
      state.nodeCount++

      if child.data.replies is a Listing:
        parseCommentTree(child.data.replies, node.id, depth + 1, state)
```

### `"kind": "more"` handling

- Do NOT fetch `/api/morechildren`. This is an explicit non-goal.
- Create a stub node: `{ id: "more_{parentId}", isStub: true, childCount: data.count, body: "", bodyHtml: "", author: "", score: 0, depth, parentId, permalink: "", createdUtc: 0 }`.
- The frontend renders these as "load more" placeholder nodes in the graph.

### 500-comment cap logic

- Maintain a running `nodeCount` during recursive parse.
- When `nodeCount` reaches 500, stop adding real nodes.
- For the remaining unprocessed top-level comments, create a single stub node indicating truncation.
- Set `ThreadData.isTruncated = true`.
- The cap is on parsed nodes, not on the raw response size. Reddit may return 1000+ items in a single `.json` response; we parse all of them but stop emitting nodes at 500.

### Key decisions

- **Depth-first traversal with breadth priority.** Parse top-level comments first (they appear in Reddit's sort order), then recurse into each thread. This ensures the 500-cap favors top-level breadth over deep nesting.
- **Actually: breadth-first for cap fairness.** On reflection, a pure DFS would exhaust the cap on the first deeply-nested top-level comment. Instead, implement a two-pass approach: (1) collect all top-level comments, (2) for each, recurse up to depth 2 if the thread exceeds 500 total comments (as specified in PRD SS4.1 item 8). For threads under 500 comments, do a full DFS with no depth limit.
- **ID normalization.** Reddit IDs come as `t1_abc123`. Strip the `t1_` prefix and use `abc123` as the canonical ID. Parent IDs (`parent_id` field) also need prefix stripping. The thread post itself uses `t3_` prefix.

### Estimated effort

10 hours (fetch module + parser + extensive test coverage against real Reddit response shapes).

### Dependencies

- `lib/types.ts` (section 1).
- `lib/sanitize.ts` (section 8) -- called during parse to produce `bodyHtml`.
- `lib/sentiment.ts` (section 7) -- called during parse or as a post-processing step.
- Test fixtures captured from real Reddit responses.

---

## 4. Rate Limiting

### What to build

Per-IP rate limiter using Upstash Redis. 10 requests per minute per IP on the `/api/thread` route. Returns 429 with `Retry-After` header when exceeded.

### Files

| File | Action |
|------|--------|
| `lib/rateLimiter.ts` | Create. Exports `RateLimiter` class or `checkRateLimit(ip: string): Promise<RateLimitResult>` function. |
| `tests/lib/rateLimiter.test.ts` | Create. Tests with mocked Redis client. |

### Implementation approach

Use `@upstash/ratelimit` package with sliding window algorithm:

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "tc:ratelimit",
  analytics: true,
});
```

### Return type

```typescript
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;       // Unix timestamp
  retryAfterSeconds: number;
}
```

### Key decisions

- **Use `@upstash/ratelimit` rather than rolling our own.** It handles the sliding window atomically in Redis with a single round-trip. Battle-tested, zero reason to reimplement.
- **Sliding window, not fixed window.** Fixed windows allow burst at window boundaries (up to 20 requests in 2 seconds straddling a window reset). Sliding window is smoother.
- **`Retry-After` is seconds, not a date.** Simpler for clients to consume. Calculated as `Math.ceil((resetAt - Date.now()) / 1000)`.
- **Graceful degradation.** If Redis is unreachable, allow the request through (fail open). Log the Redis error. Blocking all users because Redis is down is worse than briefly losing rate limiting.

### Estimated effort

3 hours (implementation is straightforward with `@upstash/ratelimit`; most time is on tests and the fail-open logic).

### Dependencies

- Upstash Redis instance provisioned and `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars configured.
- Frontend team needs to handle 429 responses and display the retry countdown.

---

## 5. Caching Strategy

### What to build

Upstash Redis caching layer. All Reddit API responses are cached for 15 minutes. Cache sits inside `RedditJsonDataSource`, transparent to the API route.

### Files

| File | Action |
|------|--------|
| `lib/cache.ts` | Create. Exports `ThreadCache` class with `get(key: string): Promise<ThreadData | null>` and `set(key: string, data: ThreadData): Promise<void>`. |
| `tests/lib/cache.test.ts` | Create. Tests with mocked Redis. |

### Cache key design

```typescript
function buildCacheKey(url: string): string {
  // Normalize: lowercase, strip trailing slash, strip query params, strip .json suffix
  const normalized = url
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.json$/, "")
    .split("?")[0];
  return `tc:thread:${normalized}`;
}
```

Examples:
- `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/` -> `tc:thread:https://www.reddit.com/r/askreddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit`
- Same URL with `.json` suffix -> same key.
- Same URL with `?sort=top` -> same key.

### TTL

- 15 minutes (900 seconds), set via `EX 900` on Redis SET.
- No manual invalidation. TTL-only expiry is correct for this use case: Reddit data is not real-time, comments update slowly, and stale data for 15 minutes is acceptable.

### What gets cached

The fully parsed `ThreadData` object (post-sentiment-scoring, post-sanitization). This avoids re-parsing and re-sanitizing on cache hits. The cached object is serialized as JSON.

### Size considerations

- A 500-node `ThreadData` object is roughly 200-400 KB as JSON.
- Upstash free tier allows 256 MB. At ~300 KB per thread, that is ~850 cached threads. More than sufficient.
- No compression needed at this scale. If it becomes an issue later, `zlib` compress before storing.

### Key decisions

- **Cache the parsed output, not the raw Reddit response.** Parsing + sanitizing + sentiment scoring costs CPU time. Caching the final product means cache hits are pure serialization/deserialization.
- **Single-layer cache.** No in-memory LRU in front of Redis. The Vercel serverless model means each invocation may hit a different isolate, making in-memory caches unreliable. Redis is the single source of truth.
- **Include `fetchedAt` in cached data.** The API response includes `meta.cached` and `meta.ttlRemaining` so the frontend can show data freshness ("fetched 3 min ago").
- **`ttlRemaining` via Redis TTL command.** After a cache hit, call `redis.ttl(key)` to get remaining TTL and include it in the response meta.

### Estimated effort

4 hours.

### Dependencies

- Same Upstash Redis instance as rate limiter.
- `lib/types.ts` for `ThreadData` type.

---

## 6. Comment Parsing & Normalization

### What to build

The recursive parser that converts Reddit's nested JSON tree into the flat `CommentNode[]` + `ThreadEdge[]` adjacency list defined in `lib/types.ts`.

This is covered in section 3 (Reddit `.json` Fetch Logic) as the `parseRedditResponse` function in `lib/redditParser.ts`. This section adds specifics on edge cases.

### Handling deleted/removed comments

Reddit marks deleted comments in two ways:
- `author === "[deleted]"` and `body === "[deleted]"` -- user-deleted.
- `author === "[deleted]"` and `body === "[removed]"` -- mod-removed.

**Decision:** Include these nodes in the graph. They are structurally important (replies to them exist). Set `author` to `"[deleted]"` and `body`/`bodyHtml` to the literal text. They render as gray nodes in the graph regardless of sentiment.

### Handling edge cases

| Case | Behavior |
|------|----------|
| `body` is `null` or empty string | Set `body = ""`, `bodyHtml = ""`. Node is valid but contentless. |
| `score` is `null` (score hidden) | Set `score = 1` (neutral default). |
| `created_utc` is missing | Set `createdUtc = 0`. |
| `permalink` is relative | Prepend `https://www.reddit.com`. |
| Duplicate IDs (should not happen) | Skip duplicate, log warning. |
| Circular parent references | Track visited IDs, skip if already visited. |

### 500-comment cap with depth-based truncation

For threads where `num_comments > 500`:
1. Parse all top-level comments (depth 0).
2. For each top-level comment, parse replies up to depth 2 (depth 1 and depth 2).
3. At depth 2, if children exist, create a stub node.
4. Stop emitting real nodes at 500 total. If there are more than 500 nodes even with the depth-2 cap, truncate further by stopping iteration over top-level comments.
5. Set `isTruncated = true`.

For threads where `num_comments <= 500`:
1. Parse the full tree with no depth limit.
2. `"kind": "more"` stubs are still rendered as stub nodes.
3. Set `isTruncated = false`.

### The thread post as root node

The original post (from `[0]` in the Reddit response) becomes a special `CommentNode`:
- `id` = thread ID (from `t3_` prefix, stripped).
- `parentId = null`.
- `depth = 0`.
- `body` = post selftext (if any).
- `isStub = false`.
- All top-level comments have `parentId` pointing to this root node.

This gives the graph a single root, making the force-directed layout cleaner.

### Estimated effort

Included in section 3 estimate (10 hours total for fetch + parse).

### Dependencies

- Section 8 (sanitize) for `bodyHtml` generation.
- Section 7 (sentiment) for scoring during parse.
- Test fixtures (section 1).

---

## 7. Sentiment Scoring

### What to build

AFINN-based word-level sentiment scoring for each comment. Produces a normalized score used by the frontend to color nodes.

### Files

| File | Action |
|------|--------|
| `lib/sentiment.ts` | Create. Exports `scoreSentiment(text: string): number`. |
| `lib/afinn.ts` | Create. AFINN-165 word list as a `Record<string, number>` constant (or import from `afinn-165` npm package). |
| `tests/lib/sentiment.test.ts` | Create. |

### Algorithm

1. Lowercase the input text.
2. Tokenize on word boundaries (`/\b\w+\b/g`).
3. Sum AFINN scores for all matched words.
4. Normalize to [-1, 1] range: `normalized = Math.max(-1, Math.min(1, rawSum / (Math.abs(rawSum) + 5)))`. The `+ 5` damping factor prevents short comments with one strong word from dominating.
5. Return the normalized score.

### Score interpretation

| Range | Label | Color |
|-------|-------|-------|
| 0.2 to 1.0 | Positive | Blue |
| -0.2 to 0.2 | Neutral | Gray |
| -1.0 to -0.2 | Negative | Orange |

### Key decisions

- **Server-side scoring during parse.** Scoring happens in `redditParser.ts` (or as a post-processing map over nodes) before caching. This means cache hits include pre-computed scores, and the frontend does not need the AFINN word list.
- **AFINN-165 over custom models.** It is a 3,400-word list with integer scores from -5 to +5. Simple, deterministic, zero external API calls, works on any text length. Not perfect for Reddit slang, but good enough for directional sentiment.
- **No ML, no API calls.** Keeps the project zero-cost and deterministic.
- **Stub nodes get score 0.** They have no text content.
- **Deleted/removed comments get score 0.** `"[deleted]"` and `"[removed]"` are not in AFINN.

### Estimated effort

3 hours (straightforward implementation; most time on normalization tuning and tests).

### Dependencies

- `afinn-165` npm package or inline word list.
- No external dependencies from other team members.

---

## 8. Sanitization

### What to build

DOMPurify wrapper that sanitizes Reddit comment HTML before it is stored in `CommentNode.bodyHtml` and ultimately rendered in the detail panel.

### Files

| File | Action |
|------|--------|
| `lib/sanitize.ts` | Create. Exports `sanitizeHtml(html: string): string`. |
| `tests/lib/sanitize.test.ts` | Create. Tests for XSS vectors, preserved formatting. |

### Implementation

Use `isomorphic-dompurify` (works in Node.js, unlike browser-only `dompurify`) or `dompurify` with `jsdom`:

```typescript
import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "a", "code", "pre",
      "blockquote", "ul", "ol", "li", "del", "sup",
      "table", "thead", "tbody", "tr", "th", "td",
      "h1", "h2", "h3", "h4", "h5", "h6", "hr",
    ],
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false,
  });
}
```

### What to strip

- `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>` -- XSS vectors.
- `style` attributes -- prevent CSS injection.
- `on*` event handler attributes -- prevent JS execution.
- `data-*` attributes -- unnecessary, potential tracking vector.

### What to preserve

- Basic formatting: `<p>`, `<br>`, `<strong>`, `<em>`, `<del>`, `<sup>`.
- Links: `<a href="...">` (with `href` attribute only, no `target`, no `onclick`).
- Code: `<code>`, `<pre>`.
- Lists: `<ul>`, `<ol>`, `<li>`.
- Quotes: `<blockquote>`.
- Tables: Reddit markdown supports tables.
- Headings: `<h1>` through `<h6>`.

### Reddit HTML specifics

Reddit's `.json` response includes `body_html` for each comment, which is pre-rendered HTML. However, it is HTML-entity-encoded (e.g., `&lt;p&gt;`). Before sanitizing:
1. Decode HTML entities (the JSON parser handles the first level, but Reddit double-encodes).
2. Pass through DOMPurify.
3. Store result in `CommentNode.bodyHtml`.

### Key decisions

- **Server-side sanitization.** Sanitize during parse, before caching. This ensures cached data is already safe. The frontend never receives unsanitized HTML.
- **`isomorphic-dompurify` over `sanitize-html`.** DOMPurify is the industry standard for XSS prevention. `isomorphic-dompurify` bundles `jsdom` for Node.js compatibility.
- **Allowlist, not blocklist.** Only explicitly permitted tags and attributes pass through. Everything else is stripped. This is defense-in-depth against unknown attack vectors.

### Estimated effort

3 hours.

### Dependencies

- `isomorphic-dompurify` npm package.
- No dependencies on other team members' work.

---

## 9. Error Handling

### What to build

A consistent error handling strategy for all failure modes in the Reddit fetch pipeline. Errors are caught, classified, and mapped to appropriate HTTP status codes in the API route.

### Files

| File | Action |
|------|--------|
| `lib/errors.ts` | Create. Custom error classes: `RedditApiError`, `RateLimitError`, `ValidationError`, `UpstreamError`. |
| Modifications to `lib/redditFetch.ts` | Add retry logic and error classification. |
| Modifications to `app/api/thread/route.ts` | Add catch block that maps error classes to HTTP responses. |

### Error classification

| Failure mode | Error class | HTTP status | Behavior |
|---|---|---|---|
| Invalid/disallowed URL | `ValidationError` | 400 | Immediate reject, no retry. |
| IP rate limit exceeded | `RateLimitError` | 429 | Immediate reject with `Retry-After`. |
| Reddit returns 429 | `UpstreamError` | 502 | Retry with backoff (see below). |
| Reddit returns 503 | `UpstreamError` | 502 | Retry with backoff. |
| Reddit returns 404 | `UpstreamError` | 502 | No retry. Thread does not exist. Return specific message. |
| Reddit returns 403 | `UpstreamError` | 502 | No retry. Thread is private or quarantined. |
| Network timeout (>10s) | `UpstreamError` | 502 | Retry with backoff. |
| DNS/connection failure | `UpstreamError` | 502 | Retry with backoff. |
| Malformed JSON response | `UpstreamError` | 502 | No retry. Log the anomaly. |
| Unexpected exception | `Error` | 500 | No retry. Log full stack trace. |
| Redis unreachable (cache) | Swallowed | N/A | Proceed without cache. Log warning. |
| Redis unreachable (rate limit) | Swallowed | N/A | Allow request through. Log warning. |

### Exponential backoff strategy

For retryable Reddit API failures (429, 503, timeout, connection error):

```
maxRetries = 2  (3 total attempts)
baseDelay = 1000ms
attempt 1: immediate
attempt 2: 1000ms delay
attempt 3: 2000ms delay
```

Total maximum wait: 3 seconds. This fits within the 10-second uncached response target from acceptance criteria.

Jitter: add `Math.random() * 500ms` to each delay to avoid thundering herd if multiple requests hit Reddit's rate limit simultaneously.

### Key decisions

- **Only 2 retries.** The 10-second uncached budget is tight. Each retry burns 1-3 seconds of delay plus the request time. Two retries is the maximum that fits.
- **Never retry client errors (400-level from our API).** These are user errors and retrying will not fix them.
- **Reddit 429 is retried, our 429 is not.** When Reddit rate-limits us, we retry with backoff. When we rate-limit a client, we return 429 immediately.
- **Fail open on Redis errors.** Cache miss and rate limit bypass are better than blocking all requests because Redis is temporarily unreachable.
- **Structured error responses.** Every error response includes a machine-readable `code` field. The frontend switches on this field, not on the human-readable message.

### Estimated effort

4 hours.

### Dependencies

- Integrated into `lib/redditFetch.ts` (section 3) and `app/api/thread/route.ts` (section 2).

---

## 10. User-Agent & Request Headers

### What to build

All outbound HTTP requests to Reddit include the correct headers to comply with Reddit's (informal) requirements for `.json` endpoint access.

### Implementation location

`lib/redditFetch.ts` -- the `fetchRedditJson` function sets headers on every outbound request.

### Headers

```typescript
const headers = {
  "User-Agent": "ThreadCartographer/1.0 (web app; +https://github.com/justin/reddit-json)",
  "Accept": "application/json",
};
```

### Key decisions

- **`User-Agent` format follows Reddit's convention.** Reddit's API rules request a descriptive User-Agent with contact info. Even though `.json` is undocumented, a good User-Agent reduces the chance of being blocked.
- **No `Authorization` header.** Phase 1 uses unauthenticated access (60 req/min limit). OAuth is a non-goal.
- **No cookies.** Sending cookies could trigger anti-bot protections.
- **`Accept: application/json`.** Explicit content type negotiation. Reddit's `.json` endpoint returns JSON regardless, but this is good practice.
- **No custom `Referer` or `Origin`.** These are browser headers and would look suspicious from a server-side request.

### Estimated effort

30 minutes (trivial implementation, but documenting the decision matters).

### Dependencies

- None.

---

## Build Order & Dependency Graph

Infrastructure must be built and tested before the data pipeline, and the data pipeline before the API route. The recommended build sequence:

```
Phase A: Foundation (parallel, ~1 day)
  [1] lib/types.ts
  [2] lib/errors.ts
  [3] lib/sanitize.ts + tests
  [4] lib/sentiment.ts + lib/afinn.ts + tests

Phase B: Infrastructure (parallel, ~1.5 days)
  [5] lib/cache.ts + tests
  [6] lib/rateLimiter.ts + tests
  [7] lib/dataSource.ts (interface only)
  [8] tests/fixtures/ (capture Reddit JSON snapshots)

Phase C: Data Pipeline (sequential, ~2 days)
  [9] lib/redditFetch.ts + tests (depends on A2, A3, A4)
  [10] lib/redditParser.ts + tests (depends on A1, A3, A4, B8)
  [11] lib/redditJsonDataSource.ts + tests (depends on everything above)

Phase D: API Route (~1 day)
  [12] app/api/thread/route.ts + tests (depends on B5, B6, C11)
  [13] tests/lib/fixtureDataSource.ts (depends on B7, B8)

Phase E: Integration Testing (~0.5 days)
  [14] End-to-end test: URL in -> ThreadData out
  [15] Error scenario tests (Reddit down, rate limited, malformed, etc.)
```

**Total estimated effort: 5-6 working days.**

---

## npm Packages Required

| Package | Purpose | Dev/Prod |
|---------|---------|----------|
| `@upstash/redis` | Redis client for caching and rate limiting | prod |
| `@upstash/ratelimit` | Sliding window rate limiter | prod |
| `isomorphic-dompurify` | HTML sanitization (Node.js compatible) | prod |
| `afinn-165` | AFINN sentiment word list | prod |
| `msw` | HTTP mocking for Reddit API tests | dev |
| `vitest` | Test runner (already specified in CLAUDE.md) | dev |

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token | Yes |

These must be set in `.env.local` for development and in Vercel project settings for production.

---

## Open Questions for Team Discussion

1. **Should the root post node be included in the 500-comment cap?** Current plan: no, the root post is always included and the 500 cap applies only to comment nodes. This means the graph can have up to 501 nodes.

2. **Cache key: should we include sort order?** Reddit threads can be fetched with `?sort=top`, `?sort=new`, etc. Current plan strips query params from cache keys, meaning all sort orders share one cached result. If sort-specific caching is desired, the key design needs to change.

3. **Should `bodyHtml` come from Reddit's `body_html` field or from rendering `body` (markdown) ourselves?** Current plan uses Reddit's pre-rendered `body_html` and sanitizes it. Alternative: use a markdown renderer for full control. The Reddit `body_html` approach is simpler and avoids adding a markdown parser dependency.

4. **Monitoring/alerting.** The PRD mentions Vercel and Upstash dashboards for metrics. Should we add structured logging (e.g., `console.log(JSON.stringify({...}))`) for Vercel log drains, or is that Phase 2 polish?
