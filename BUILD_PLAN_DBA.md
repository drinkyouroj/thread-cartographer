# Build Plan: Database Administration

**Role:** Senior Database Administrator
**Project:** Thread Cartographer
**Date:** 2026-03-26
**PRD Reference:** `docs/decisions/DECISION-001-thread-cartographer-prd.md`

---

## 1. Redis Data Model (Phase 1)

### Key Naming Conventions

All Redis keys use a colon-delimited namespace pattern. This is the de facto Redis convention and makes key scanning, debugging, and future partitioning straightforward.

```
tc:cache:thread:<normalized_thread_id>    — cached ThreadData JSON
tc:ratelimit:<ip_hash>:<window_id>        — per-IP request counter
tc:meta:stats                             — optional hit/miss counters (see Section 6)
```

Prefix `tc:` (Thread Cartographer) prevents collisions if the Upstash instance is shared with other projects in the future.

### Data Structures

| Key Pattern | Redis Type | Value | TTL |
|---|---|---|---|
| `tc:cache:thread:<id>` | STRING | JSON-serialized `ThreadData` | 900s (15 min) |
| `tc:ratelimit:<ip_hash>:<window>` | STRING (counter) | Integer request count | 60s |
| `tc:meta:hits` | STRING (counter) | Integer, incremented on cache hit | None (persistent) |
| `tc:meta:misses` | STRING (counter) | Integer, incremented on cache miss | None (persistent) |

### Serialization Format

All cached data is stored as JSON via `JSON.stringify()`. No binary formats (MessagePack, Protobuf) in Phase 1. Rationale:

- Upstash REST API natively handles JSON strings without encoding overhead.
- ThreadData is already a plain TypeScript object -- no circular references, no Date objects, no Maps.
- Debugging is trivial: you can read values directly in the Upstash console.
- At our scale (hundreds of keys, not millions), serialization performance is irrelevant.

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/cache.ts` | Create | Redis caching layer with get/set/key-normalization functions |
| `lib/types.ts` | Create | Must include `ThreadData` exactly as defined in PRD Section 4.4 |

### Decisions

- **STRING over HASH:** ThreadData is always read and written as a complete unit -- never partial field access. STRING with JSON is simpler and avoids the complexity of mapping nested arrays (nodes, edges) into HASH fields.
- **No Redis JSON module:** Upstash free tier does not support RedisJSON. Plain STRING is sufficient.
- **TTL set at write time:** Every `SET` call includes `EX 900`. No separate `EXPIRE` calls.

### Effort

- 4 hours: implement `lib/cache.ts` with key normalization, get, set, TTL logic.
- 2 hours: unit tests with mock Redis client.

### Dependencies

- Backend engineer delivers `lib/types.ts` with the `ThreadData` interface (or DBA creates it from PRD spec).
- Upstash Redis instance provisioned and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` available as environment variables.

---

## 2. Cache Key Design

### URL Normalization Strategy

Reddit thread URLs arrive in many forms. All of the following must resolve to the same cache key:

```
https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/
https://reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit
http://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/
https://old.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/?sort=top
https://www.reddit.com/r/AskReddit/comments/t0ynr/.json
```

### Normalization Algorithm

```
1. Parse URL with the URL constructor.
2. Strip query parameters entirely (sort order is not part of our cache identity).
3. Strip hash fragments.
4. Remove trailing slashes.
5. Remove `.json` suffix if present.
6. Replace hostname with canonical `reddit.com` (strip www., old., new., np.).
7. Force protocol to https.
8. Extract the thread ID from the path: match /r/<subreddit>/comments/<thread_id>/
9. Cache key = tc:cache:thread:<thread_id>
```

**Critical decision: key by thread ID, not by full URL.** The thread ID (`t0ynr` in the example above) is the unique, immutable identifier for a Reddit thread. The slug after it (the title portion) is cosmetic and can change. Two different URLs with the same thread ID always refer to the same thread.

This means the cache key is simply:

```
tc:cache:thread:t0ynr
```

This is short (fewer bytes in Redis), collision-free, and trivially debuggable.

### Edge Cases

| Case | Handling |
|---|---|
| URL has comment permalink (`/comment/xyz`) | Strip the comment path segment. Cache the full thread. |
| URL uses short link (`redd.it/t0ynr`) | Extract thread ID directly. Same cache key. |
| URL has `.json` suffix | Strip before normalization. |
| Mixed case in subreddit name | Lowercase the entire path (Reddit is case-insensitive). |

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/cache.ts` | Create | `normalizeThreadUrl(url: string): string` function that returns the thread ID |
| `tests/lib/cache.test.ts` | Create | Test matrix covering all URL variations above |

### Effort

- 3 hours: implement normalization + comprehensive test suite.

### Dependencies

- None. This is a pure function with no external dependencies.

---

## 3. Rate Limit Storage

### Design: Fixed Window with Atomic Increment

Use a fixed-window counter per IP address. Each window is 60 seconds. The key encodes the IP and the window timestamp.

```
Key:    tc:ratelimit:<hashed_ip>:<minute_timestamp>
Value:  integer (request count)
TTL:    60 seconds
```

Where `<minute_timestamp>` is `Math.floor(Date.now() / 60000)`.

### Why Fixed Window Over Sliding Window

| Factor | Fixed Window | Sliding Window |
|---|---|---|
| Redis commands per check | 1 (INCR + EX) | 3+ (ZADD, ZREMRANGEBYSCORE, ZCARD) |
| Upstash cost (commands billed) | Lower | Higher |
| Burst at window boundary | Theoretically 2x burst (20 in 2s) | No boundary burst |
| Implementation complexity | Trivial | Moderate |
| PRD requirement | "10 requests per minute" | Not specified |

**Decision: Fixed window.** The 2x boundary burst is acceptable for a portfolio project with a 10 req/min limit. The worst case (20 requests in a 2-second window) still does not approach Reddit's 60 req/min limit because multiple users would need to hit the same thread simultaneously. If boundary bursts become an issue, we can upgrade to sliding window without changing the key schema.

### IP Hashing

Store a SHA-256 hash of the IP address, not the raw IP. This avoids storing PII in Redis while still providing unique per-IP counters.

```typescript
import { createHash } from 'crypto';
const hashedIp = createHash('sha256').update(ip).digest('hex').slice(0, 16);
```

Truncate to 16 hex characters (64 bits). Collision probability across 10,000 unique IPs is negligible (~3 x 10^-12).

### Rate Limit Check Flow

```
1. Compute key: tc:ratelimit:<hashed_ip>:<window>
2. INCR key (atomic increment, returns new count)
3. If count === 1, SET key TTL to 60 seconds (first request in window)
4. If count > 10, return 429 with Retry-After header
5. Otherwise, proceed with request
```

Use Upstash's `INCR` with `EX` in a single pipeline call to minimize round trips.

### Retry-After Header

Calculate seconds remaining in the current window:

```typescript
const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
```

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/rateLimiter.ts` | Create | `checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfter?: number }>` |
| `tests/lib/rateLimiter.test.ts` | Create | Test limit enforcement, TTL behavior, 429 response |

### Effort

- 3 hours: implement rate limiter with Upstash SDK.
- 2 hours: unit tests with mock Redis.

### Dependencies

- Upstash Redis credentials in environment.
- Backend engineer integrates rate limiter into `app/api/thread/route.ts`.

---

## 4. Memory Budget

### ThreadData Size Estimation

A single `ThreadData` object for a 500-comment thread (the cap):

| Field | Estimated Size |
|---|---|
| Thread metadata (title, author, subreddit, url, score, etc.) | ~500 bytes |
| Per CommentNode (avg): id (10B) + author (20B) + body (300B) + bodyHtml (500B) + score (8B) + depth (4B) + parentId (10B) + permalink (80B) + createdUtc (8B) + isStub (4B) | ~944 bytes |
| 500 CommentNodes | ~472 KB |
| 500 ThreadEdges (source + target, ~24B each) | ~12 KB |
| JSON serialization overhead (keys, quotes, braces, commas) | ~30% markup |
| **Total per thread (500 comments)** | **~630 KB** |

Smaller threads scale linearly. A 50-comment thread is roughly 63 KB.

### Scaling Estimates

| Cached Threads | Avg Comments | Estimated Memory | Upstash Free Tier (256 MB) |
|---|---|---|---|
| 10 | 300 | ~3.8 MB | 1.5% |
| 100 | 300 | ~38 MB | 14.8% |
| 1,000 | 300 | ~380 MB | **Exceeds free tier** |
| 100 | 500 (max) | ~63 MB | 24.6% |

### Upstash Free Tier Limits (as of 2026)

| Resource | Free Tier Limit |
|---|---|
| Storage | 256 MB |
| Daily commands | 10,000 |
| Max request size | 1 MB |
| Connections | Unlimited (REST API) |

### Analysis

- At typical usage (50-200 cached threads with 15-min TTL), memory stays well under 256 MB.
- A single 500-comment ThreadData blob (~630 KB) is under the 1 MB request size limit.
- 10,000 daily commands is the binding constraint. Each thread fetch involves 2 commands (GET check + SET on miss, or just GET on hit). Rate limit checks add 1-2 commands per request. Budget: ~3,000-5,000 unique requests per day before hitting the command limit.
- **If the command limit becomes an issue:** enable Upstash's pay-as-you-go plan ($0.2 per 100K commands). At $0/month is a hard requirement per the PRD, monitor this closely.

### Recommendations

1. **Do not compress** cached JSON in Phase 1. The complexity is not justified at this scale.
2. **Monitor daily command usage** in Upstash dashboard weekly.
3. **If approaching 256 MB**, reduce TTL from 900s to 600s (10 min). This halves steady-state cache size with minimal UX impact.
4. **Consider storing only the parsed ThreadData**, not the raw Reddit API response. The PRD architecture already implies this (DataSource.fetchThread returns ThreadData, cache stores ThreadData).

### Files to Create/Modify

None -- this section is informational. Implement monitoring per Section 6.

### Effort

- 1 hour: document limits in a comment block in `lib/cache.ts`.

### Dependencies

- None.

---

## 5. Data Lifecycle

### TTL Strategy

| Key Type | TTL | Rationale |
|---|---|---|
| Thread cache | 900 seconds (15 min) | PRD requirement. Balances freshness vs. Reddit API rate limits. |
| Rate limit counter | 60 seconds | Matches the 1-minute rate limit window. |
| Meta counters (hits/misses) | None (persistent) | Long-lived metrics. Reset manually if needed. |

### Eviction Behavior

Upstash uses volatile-lru eviction by default when memory is full: keys with a TTL set are evicted first, least-recently-used first. This is ideal for our use case:

- Thread cache keys all have TTLs and are the bulk of memory usage. They will be evicted first.
- Rate limit keys have TTLs and are tiny. They will expire naturally.
- Meta counters have no TTL and will survive eviction (they are a few bytes).

**No custom eviction logic needed.** Redis handles this correctly out of the box.

### Cold Cache Behavior

When the cache is cold (empty -- after deployment, after TTL expiry, or after eviction):

1. User submits a thread URL.
2. `cache.get()` returns `null`.
3. `RedditJsonDataSource` fetches from Reddit's `.json` endpoint.
4. Response is parsed into `ThreadData`.
5. `ThreadData` is stored in cache with 15-min TTL.
6. Response is returned to user.

**User impact:** First request takes 3-8 seconds instead of <1 second. This is acceptable and expected.

**There is no "warming" strategy in Phase 1.** No pre-fetching, no background refresh. The cache is demand-populated only.

### Data Staleness

ThreadData cached for up to 15 minutes may be stale (new comments, changed scores). The PRD acknowledges this trade-off. The frontend should display the `fetchedAt` timestamp so users understand data freshness.

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/cache.ts` | Create | TTL constants (`THREAD_CACHE_TTL = 900`, `RATE_LIMIT_TTL = 60`) |

### Effort

- Included in Section 1 effort (cache.ts implementation).

### Dependencies

- None.

---

## 6. Monitoring and Observability

### Metrics to Track

The PRD requires a 70% cache hit rate target after 50+ unique threads fetched.

| Metric | How to Measure | Where |
|---|---|---|
| Cache hit rate | `tc:meta:hits / (tc:meta:hits + tc:meta:misses)` | Application code increments counters; read via Upstash console or a `/api/health` endpoint |
| Total memory usage | Upstash dashboard "Memory Usage" panel | Upstash console |
| Key count | Upstash dashboard "Total Keys" panel | Upstash console |
| Daily commands used | Upstash dashboard "Daily Commands" panel | Upstash console |
| Rate limit triggers (429s) | Vercel function logs, filtered by status 429 | Vercel dashboard > Logs |
| P95 response time (cached vs uncached) | Vercel function duration logs | Vercel dashboard > Functions |

### Cache Hit Rate Measurement

Implement two atomic counters in Redis:

```typescript
// In lib/cache.ts, within the get function:
if (cached) {
  await redis.incr('tc:meta:hits');
  return cached;
} else {
  await redis.incr('tc:meta:misses');
  return null;
}
```

**Trade-off:** This adds 1 extra Redis command per request (the INCR). At our scale (~100-500 requests/day), this is negligible against the 10,000 daily command limit. If command budget becomes tight, make these counters opt-in via an environment variable (`ENABLE_CACHE_METRICS=true`).

### Health Endpoint (Optional)

Create a lightweight health/stats endpoint:

```
GET /api/health → { cacheHits, cacheMisses, hitRate, uptime }
```

This is not in the PRD scope but is valuable for the DBA to verify the 70% hit rate target.

### Alerting

No automated alerting in Phase 1. Manual checks via the Upstash dashboard are sufficient for a portfolio project. Review metrics weekly.

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/cache.ts` | Modify | Add INCR calls for hit/miss counters |
| `app/api/health/route.ts` | Create (optional) | Lightweight stats endpoint |
| `tests/lib/cache.test.ts` | Modify | Verify counter increment behavior |

### Effort

- 2 hours: add counters to cache.ts.
- 2 hours: optional health endpoint.

### Dependencies

- `lib/cache.ts` must be implemented first (Section 1).

---

## 7. Phase 2 Database Planning

### When PostgreSQL Becomes Needed

Phase 2 (AskReddit Story Explorer) introduces:

- Browsing top AskReddit threads sorted by score and filtered by time range.
- Surfacing long-form responses by character length + score.
- Content sensitivity filtering (NSFW, keywords).
- Possibly a "distraction-free reading mode" with ISR.

These requirements imply **persistent, queryable data** -- not ephemeral cache. Redis is the wrong tool for:

- Full-text search across story content.
- Complex filtering (score > X AND length > Y AND time_range = '30d' AND nsfw = false).
- Sorted pagination across thousands of threads.

**PostgreSQL becomes necessary when Phase 2 starts.** Specifically, when the first feature requiring a `WHERE` clause on persistent data is built.

### Recommended Stack

| Component | Tool | Rationale |
|---|---|---|
| Database | Neon Postgres (serverless) | Free tier, serverless-friendly, Vercel Marketplace integration |
| ORM | Drizzle ORM | Lightweight, TypeScript-native, good Neon support |
| Migrations | Drizzle Kit | Co-located with schema definitions |
| Connection | Neon serverless driver (`@neondatabase/serverless`) | HTTP-based, no connection pooling headaches in Vercel |

### Proposed Schema (Phase 2)

```sql
-- threads table: persistent store of fetched AskReddit threads
CREATE TABLE threads (
  id              TEXT PRIMARY KEY,         -- Reddit thread ID (e.g., 't0ynr')
  title           TEXT NOT NULL,
  subreddit       TEXT NOT NULL,
  author          TEXT NOT NULL,
  url             TEXT NOT NULL,
  score           INTEGER NOT NULL,
  comment_count   INTEGER NOT NULL,
  created_utc     BIGINT NOT NULL,
  is_nsfw         BOOLEAN DEFAULT FALSE,
  fetched_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- stories table: long-form AskReddit responses worth reading
CREATE TABLE stories (
  id              TEXT PRIMARY KEY,         -- Reddit comment ID
  thread_id       TEXT NOT NULL REFERENCES threads(id),
  author          TEXT NOT NULL,
  body            TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  score           INTEGER NOT NULL,
  char_length     INTEGER NOT NULL,         -- pre-computed for filtering
  depth           INTEGER NOT NULL,
  permalink       TEXT NOT NULL,
  created_utc     BIGINT NOT NULL,
  sentiment_score REAL,                     -- AFINN score, nullable
  is_nsfw         BOOLEAN DEFAULT FALSE
);

-- Indexes for Phase 2 query patterns
CREATE INDEX idx_threads_score ON threads(score DESC);
CREATE INDEX idx_threads_created ON threads(created_utc DESC);
CREATE INDEX idx_threads_subreddit ON threads(subreddit);
CREATE INDEX idx_stories_thread ON stories(thread_id);
CREATE INDEX idx_stories_score_length ON stories(score DESC, char_length DESC);
CREATE INDEX idx_stories_fts ON stories USING gin(to_tsvector('english', body));
```

### Migration Path: Redis-Only to Redis + Postgres

Phase 1 (Redis-only) and Phase 2 (Redis + Postgres) coexist. Redis is not replaced.

```
Phase 1:  User Request → API Route → Redis Cache → Reddit .json API
Phase 2:  User Request → API Route → Redis Cache → Reddit .json API
                                   → Postgres (persistent storage for Story Explorer)
```

**Migration steps:**

1. Provision Neon Postgres via Vercel Marketplace. Set `DATABASE_URL` env var.
2. Install Drizzle ORM + Neon serverless driver.
3. Create schema files in `lib/db/schema.ts`.
4. Run initial migration with `drizzle-kit push`.
5. Add a `StorageService` layer that writes to Postgres after fetching from Reddit (write-through pattern).
6. Redis cache continues to serve the Thread Cartographer (Phase 1) use case unchanged.
7. Story Explorer reads from Postgres, not from Redis.

**Key principle:** Redis remains the caching layer for API responses. Postgres is the persistence layer for curated/queryable data. They serve different purposes and do not replace each other.

### Files to Create (Phase 2 Only)

| File | Action | Description |
|---|---|---|
| `lib/db/schema.ts` | Create | Drizzle schema definitions |
| `lib/db/client.ts` | Create | Neon serverless connection setup |
| `lib/db/migrations/` | Create | Migration files generated by Drizzle Kit |
| `lib/storageService.ts` | Create | Write-through layer: fetch from Reddit, persist to Postgres, cache in Redis |
| `drizzle.config.ts` | Create | Drizzle Kit configuration |

### Effort

- 1 day: Provision Neon, install Drizzle, create schema, run initial migration.
- 1 day: Implement StorageService with write-through pattern.
- 0.5 day: Seed database with initial AskReddit data.

### Dependencies

- Phase 1 must be stable and deployed (per PRD go/no-go gate Section 5.1).
- Backend engineer builds the Story Explorer API routes that consume Postgres data.

---

## 8. Backup and Recovery

### Phase 1: Cache-Only Architecture

**Data loss in Phase 1 means a cold cache.** That is it.

- No user data is stored.
- No persistent state exists anywhere.
- If Upstash has an outage or all keys are flushed, the system continues to function -- it just hits Reddit directly for every request until the cache repopulates.
- Recovery time: zero. The first request after cache loss repopulates the accessed thread.

**There is nothing to back up in Phase 1.** This is a feature, not a limitation. The stateless architecture is deliberately chosen to eliminate an entire class of operational concerns.

The only consequence of total Redis failure is:

1. Increased latency (3-8s per request instead of <1s).
2. Increased load on Reddit's API (risk of rate limiting if traffic spikes during outage).
3. Rate limiting stops working (all counters reset). Mitigate with in-memory fallback counter in the API route.

### Phase 2: Postgres Persistence

When Postgres is introduced, data loss becomes a real concern.

| Data | Loss Impact | Backup Strategy |
|---|---|---|
| `threads` table | Moderate: re-fetchable from Reddit but time-consuming | Neon automated daily backups (free tier includes 7-day PITR) |
| `stories` table | Moderate: re-fetchable but curated filters/scoring may need recomputation | Same as above |
| Redis cache | None: cold cache, self-healing | No backup needed |

**Neon's free tier includes:**
- Automated daily backups.
- 7-day point-in-time recovery (PITR).
- Branch-based dev/staging databases (useful for schema migration testing).

**No custom backup scripts needed.** Neon handles this at the platform level.

### Disaster Recovery Playbook (Phase 2)

1. **Redis failure:** Do nothing. Cache repopulates on demand. Rate limiting degrades gracefully.
2. **Postgres failure:** Restore from Neon PITR to the most recent consistent snapshot. Downtime: minutes.
3. **Full Upstash + Neon failure:** Restore Postgres from Neon backup. Redis repopulates on demand. Downtime: under 1 hour.

### Files to Create/Modify

None in Phase 1. Phase 2: document recovery procedures in `docs/runbooks/disaster-recovery.md`.

### Effort

- Phase 1: 0 hours (nothing to do).
- Phase 2: 2 hours (document recovery procedures, verify Neon PITR works).

### Dependencies

- Phase 2: Neon Postgres provisioned.

---

## 9. Connection Management

### Upstash REST API vs. Redis Protocol

**Decision: Use the Upstash REST API exclusively.** Do not use the Redis TCP protocol.

| Factor | REST API | Redis Protocol (TCP) |
|---|---|---|
| Vercel serverless compatibility | Native (HTTP, stateless) | Requires connection pooling |
| Connection overhead | None (HTTP per request) | TCP handshake + TLS per cold start |
| Connection limits | Unlimited | 100 concurrent (free tier) |
| Latency | ~1-5ms (same-region) | ~1-3ms (persistent conn) |
| SDK | `@upstash/redis` (REST-based) | `ioredis`, `redis` (TCP-based) |

In Vercel's serverless model, every function invocation is potentially a cold start. TCP-based Redis clients create a new connection on each cold start, which:

- Adds 10-50ms handshake latency.
- Can exhaust the 100-connection limit under load.
- Requires connection pooling middleware (adds complexity).

The Upstash REST API avoids all of this. Each Redis command is a single HTTP request. There is no connection to manage, no pool to configure, no stale connection to handle.

### SDK Choice

Use `@upstash/redis` -- the official Upstash REST SDK for JavaScript/TypeScript.

```typescript
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

This client is:

- Designed for serverless (no connection state).
- Used in Upstash's own Vercel integration.
- Automatically handles retries and serialization.
- Tree-shakeable (small bundle impact).

### Rate Limiter SDK

Upstash also provides `@upstash/ratelimit` -- a purpose-built rate limiting library that handles the counter logic, window types, and Retry-After calculation. Evaluate whether to use it or build a custom implementation.

**Recommendation: Use `@upstash/ratelimit`.** It is:

- 3 lines of setup vs. 30+ lines of custom logic.
- Battle-tested for Vercel serverless.
- Supports fixed window, sliding window, and token bucket out of the box.
- Handles edge cases (clock skew, race conditions) that a custom implementation would need to address.

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.fixedWindow(10, '60 s'),
  prefix: 'tc:ratelimit',
});
```

### Singleton Pattern

Create the Redis client as a module-level singleton. In serverless, module-level variables persist across warm invocations of the same function instance, avoiding redundant client initialization.

```typescript
// lib/redis.ts
import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();
```

Import this singleton in both `lib/cache.ts` and `lib/rateLimiter.ts`.

### Environment Variables Required

| Variable | Source | Description |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash console / Vercel integration | REST API endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console / Vercel integration | Authentication token |

These should be set in Vercel's environment variable settings, not committed to `.env` files in the repository.

### Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `lib/redis.ts` | Create | Singleton Redis client (`Redis.fromEnv()`) |
| `lib/cache.ts` | Create | Imports from `lib/redis.ts` |
| `lib/rateLimiter.ts` | Create | Imports from `lib/redis.ts`, uses `@upstash/ratelimit` |
| `.env.local` | Create (gitignored) | Local dev credentials, documented in README |
| `.env.example` | Create | Template with placeholder values (no secrets) |

### Effort

- 2 hours: set up Redis client singleton, verify connectivity.
- 1 hour: configure environment variables in Vercel.

### Dependencies

- Upstash Redis instance created (via Vercel Marketplace integration or directly).
- `@upstash/redis` and `@upstash/ratelimit` added to `package.json`.

---

## Summary: Implementation Order

The DBA work is infrastructure-first, as the PRD mandates. Here is the build sequence:

| Order | Task | Effort | Blocked By |
|---|---|---|---|
| 1 | Provision Upstash Redis, set env vars | 1 hour | Nothing |
| 2 | Create `lib/redis.ts` (singleton client) | 1 hour | Step 1 |
| 3 | Create `lib/cache.ts` (URL normalization, get/set, TTL, counters) | 4 hours | Step 2 |
| 4 | Create `lib/rateLimiter.ts` (per-IP fixed window via `@upstash/ratelimit`) | 3 hours | Step 2 |
| 5 | Write tests for cache + rate limiter | 4 hours | Steps 3-4 |
| 6 | Add observability counters (hit/miss tracking) | 2 hours | Step 3 |
| 7 | Optional: `/api/health` endpoint | 2 hours | Step 6 |
| **Total Phase 1 DBA effort** | | **~17 hours (2-3 days)** | |

Phase 2 DBA work (Postgres provisioning, schema, migrations, StorageService) is estimated at 2.5 days and is not started until the Phase 2 go/no-go gate is passed.

---

## Appendix: Package Dependencies

```json
{
  "dependencies": {
    "@upstash/redis": "^1.34.0",
    "@upstash/ratelimit": "^2.0.0"
  },
  "devDependencies": {}
}
```

Phase 2 additions:

```json
{
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "drizzle-orm": "^0.35.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.25.0"
  }
}
```
