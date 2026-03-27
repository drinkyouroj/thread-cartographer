# Build Log

Append-only log of meaningful changes per session.

---

## 2026-03-27 — Project planning complete

### Done
- Created PRD (DECISION-001) with full Phase 1 spec, acceptance criteria, and DataSource interface
- Created specialist build plans (backend, frontend, DBA, DevOps, QA, Reddit)
- Unified into BUILD_PLAN_FULL_v1
- Ran Adversarial Agent Protocol (ARCHITECT, ADVERSARY, JUDGE) against v1
- JUDGE sustained 6 of 10 objections, partially sustained 3, overruled 1
- Incorporated all 8 required + 5 recommended changes into BUILD_PLAN_FULL_v2
- Set up Upstash Redis (careful-seasnail-86365.upstash.io)
- Created .env.example, README.md, CHANGELOG.md, build_log.md

### Decisions
- DECISION-001: Thread Cartographer PRD (Accepted)
- DECISION-002: Build Plan v1 AAP Verdict (Accepted with Required Changes)

### Next
- Week 1 Day 1: Day 1 benchmarks (Vercel latency + DOMPurify), lib/types.ts, lib/redis.ts, Vercel project setup, test fixture capture

---

## 2026-03-27 — Week 1 Day 1: Foundation + Benchmarks

### Done
- Scaffolded Next.js 16.2 project with Tailwind 4, TypeScript, Turbopack
- Implemented all Day 1 lib/ modules: types, errors, redis, cache, rateLimiter, sentiment, sanitize, dataSource
- Created dark mode theme with color-blind-safe sentiment palette
- Captured 6 test fixtures (4 live Reddit, 2 synthetic including XSS vectors)
- Wrote 43 unit tests (all passing)
- Set up Vitest, vercel.json, .vercelignore
- Deployed to Vercel, ran Day 1 benchmark

### Day 1 Benchmark Results (2026-03-27)

| Metric | Value |
|--------|-------|
| sanitize-html (100 comments) | 38ms (0.38ms/comment) |
| sanitize-html (500 extrapolated) | 188ms |
| Redis write | 43ms |
| Redis read | 25ms |
| Total processing (excl. fetch) | ~257ms |

**Finding 1: isomorphic-dompurify INCOMPATIBLE with Vercel.**
jsdom has ESM/CJS conflict (ERR_REQUIRE_ESM from @exodus/bytes). Switched to sanitize-html — pure JS, no jsdom, 5ms test suite vs 674ms.

**Finding 2: Reddit blocks ALL .json requests from Vercel IPs.**
Both /hot.json and /comments/.json return 403 consistently. This is a fundamental constraint — the Reddit fetch cannot happen server-side from Vercel.

**Finding 3: sanitize-html is extremely fast on Vercel.**
500 comments extrapolated to 188ms. Combined with Redis (68ms), total processing is ~257ms, leaving 9.7s of the 10s timeout for other work.

### Decisions
- DECISION: Switch from isomorphic-dompurify to sanitize-html (jsdom incompatible with Vercel runtime)
- DECISION: Reddit fetch must happen client-side (Vercel IPs blocked by Reddit). API route becomes a processing pipeline: client sends raw Reddit JSON, server parses/scores/sanitizes/caches/returns ThreadData. See DECISION-003 for details.

### Next
- Write DECISION-003 documenting the client-side fetch architecture change
- Implement redditFetch.ts, redditParser.ts, redditJsonDataSource.ts
- Implement app/api/thread/route.ts with new client-sends-JSON pattern
- Delete temporary benchmark route

---

## 2026-03-27 — Week 1 Day 1 PR Review + Day 2: Data Pipeline

### Done (Day 1 PR review fixes)
- PR #2 reviewed: 2 critical, 4 important issues found and fixed
- /api/health stripped to public `{ status }` only; detailed stats require HEALTH_CHECK_TOKEN
- Documented serverless state limitations (per-instance counters) in redis.ts and cache.ts
- Added tests for redis.ts (failure counter, degraded flag) and rateLimiter.ts (fail-open)
- Added tests for /api/health endpoint (auth gating)
- Fixed rate limiter stale reference on Redis recovery
- Fixed sentiment multi-line code block stripping
- Test count: 43 → 60

### Done (Architecture debate)
- Deployed 3-agent team (frontend eng, backend eng, PM) to evaluate client-side fetch vs server-side proxy
- Unanimous verdict: Option 1 (client-side fetch)
- Key consensus: verify Reddit CORS from browser on Day 2, two-phase API design, drop server-side X-Ratelimit-Remaining
- Docs saved to docs/architecture/pre-day-2-{frontend-engineer,backend-engineer,project-manager}.md

### Done (Day 2)
- lib/redditParser.ts: full Reddit JSON parser handling all 10 gotchas
  - replies="" check, t1_/t3_ prefix stripping, double-encoded HTML, two "more" flavors
  - score_hidden, orphan reparenting, permalink normalization, 500-comment cap
  - MAX_RECURSION_DEPTH=100 guard against malicious deeply nested input
- lib/redditJsonDataSource.ts: DataSource with checkCache() + processRawJson()
  - Mandatory thread ID verification (prevents cache poisoning)
  - URL validation with redd.it short URL handling
- app/api/thread/route.ts: two-phase API
  - GET /api/thread?url=... → cache check (free), returns normalized fetchUrl
  - POST /api/thread { url, redditData } → validate, parse, score, sanitize, cache (rate limited)
  - 5MB body size limit (DoS prevention)
  - Structured logging on every request
  - Full error mapping per DECISION-002 RC#8
- PR #3 reviewed: 4 critical, 4 important issues found and fixed
- Test count: 60 → 95

### Architecture: Client-Side Fetch
Reddit blocks Vercel IPs (403). Architecture adapted:
- Browser fetches Reddit .json directly (CORS: Reddit serves Access-Control-Allow-Origin: *)
- GET /api/thread?url=... checks cache, returns normalized fetchUrl if cache miss
- Client fetches Reddit using fetchUrl, POSTs raw JSON to server
- Server parses, scores sentiment, sanitizes HTML, caches, returns ThreadData

### Git State
- PR #2 (Day 1) merged to develop
- PR #3 (Day 2) merged to develop
- 95 tests passing, type-check clean, build passing

### What's Built So Far
```
lib/
  types.ts              ✅ All core types (CommentNode, ThreadEdge, ThreadData, Worker msgs)
  errors.ts             ✅ Error classes with HTTP status mapping
  redis.ts              ✅ Singleton client with failure detection
  cache.ts              ✅ Upstash 15-min TTL, thread ID extraction
  rateLimiter.ts        ✅ Sliding window via @upstash/ratelimit
  sentiment.ts          ✅ AFINN scoring with preprocessing
  afinn.ts              ✅ AFINN-165 word list
  sanitize.ts           ✅ sanitize-html with entity decoding
  dataSource.ts         ✅ DataSource interface
  redditParser.ts       ✅ Full Reddit JSON parser (all 10 gotchas)
  redditJsonDataSource.ts ✅ DataSource impl (checkCache + processRawJson)
  graphUtils.ts         ❌ Not yet (Week 2)
app/
  page.tsx              ✅ Placeholder
  layout.tsx            ✅ Dark mode, Geist fonts
  api/health/route.ts   ✅ Redis status (auth-gated details)
  api/thread/route.ts   ✅ Two-phase API (GET cache, POST process)
components/             ❌ Not yet (Week 2)
workers/                ❌ Not yet (Week 2)
styles/theme.css        ✅ Dark mode, color-blind-safe palette
tests/                  ✅ 95 tests across 9 files
tests/fixtures/         ✅ 6 Reddit JSON fixtures
```

### Next (Day 3+)
- Verify Reddit CORS from real browser (go/no-go gate for client-side fetch)
- workers/forceLayout.worker.ts — Web Worker skeleton + message protocol
- components/ControlPanel.tsx — depth slider, score threshold, color legend
- components/NodeDetail.tsx — slide-out panel with sanitized comment text
- components/UrlInput.tsx — URL input with loading states, error display
- Client-side Reddit fetch hook (browser → Reddit .json → POST to /api/thread)
