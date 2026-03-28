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

---

## 2026-03-27 — Week 1 Day 3: Web Worker + UI Components + CI

### Done
- `workers/forceLayout.worker.ts`: D3 force simulation in Web Worker
  - INIT/FILTER/STOP inbound messages, TICK/STABILIZED/ERROR outbound
  - Float32Array transferable positions for >200 nodes, JSON for smaller sets
  - Tick throttling (every 3rd tick broadcast), alpha-based convergence
  - Edge validation (unknown node IDs silently filtered)
  - Worker-specific type declarations (`workers/worker-env.d.ts`)
- `components/ControlPanel.tsx`: Left-side control panel
  - Depth slider (0 to maxAvailableDepth), score threshold slider (-100 to 1000)
  - Color-blind-safe sentiment legend (blue/gray/orange)
  - Node count summary (visible / total)
  - Accessible: ARIA labels, focus-visible rings, keyboard-navigable sliders
- `components/NodeDetail.tsx`: Right-side slide-out detail panel
  - Author, score (or "hidden"), depth, sentiment label with color
  - Sanitized HTML rendering (bodyHtml pre-sanitized server-side)
  - Stub node display ("N more comments" / "Continue on Reddit")
  - Permalink to original Reddit comment
  - Focus trap: Tab cycles within panel, Escape closes
  - CSS transition for slide-in/out animation
- `.github/workflows/ci.yml`: CI pipeline
  - lint → type-check → unit/integration tests → build
  - Node 20, npm cache, 10-min timeout
  - Mock Redis env vars for test isolation
- Component and Worker CSS added to `globals.css`
- Installed d3-force, d3-quadtree, @testing-library/react, jsdom
- Test count: 95 → 126

### Week 1 Definition of Done Status
- [x] Day 1 benchmark completed and sanitization strategy documented
- [ ] Web Worker bundling verified on Vercel deployment (need to deploy)
- [x] `curl /api/thread?url=<reddit_url>` returns valid ThreadData JSON
- [x] `curl /api/health` returns Redis ping status
- [x] Cache hit on repeated request within 15 minutes
- [x] 11th request from same IP returns 429
- [x] Non-Reddit URL returns 400
- [x] Comment permalink URL returns full thread data
- [x] All unit tests pass (126 passing)
- [x] Web Worker skeleton compiles and responds to INIT message with mock positions
- [ ] ControlPanel and NodeDetail render against mock data on preview deployment

### Git State
- Branch: feature/week1-day2-data-pipeline (continuing)
- 126 tests passing, type-check clean, lint clean (1 pre-existing warning)

### What's Built So Far
```
lib/
  types.ts              ✅ All core types
  errors.ts             ✅ Error classes with HTTP status mapping
  redis.ts              ✅ Singleton client with failure detection
  cache.ts              ✅ Upstash 15-min TTL
  rateLimiter.ts        ✅ Sliding window via @upstash/ratelimit
  sentiment.ts          ✅ AFINN scoring with preprocessing
  afinn.ts              ✅ AFINN-165 word list
  sanitize.ts           ✅ sanitize-html with entity decoding
  dataSource.ts         ✅ DataSource interface
  redditParser.ts       ✅ Full Reddit JSON parser
  redditJsonDataSource.ts ✅ DataSource impl
  graphUtils.ts         ❌ Not yet (Week 2)
app/
  page.tsx              ✅ Placeholder
  layout.tsx            ✅ Dark mode, Geist fonts
  globals.css           ✅ Theme + component styles
  api/health/route.ts   ✅ Redis status (auth-gated details)
  api/thread/route.ts   ✅ Two-phase API
components/
  ControlPanel.tsx      ✅ Depth slider, score filter, legend
  NodeDetail.tsx        ✅ Slide-out panel, focus trap
  UrlInput.tsx          ❌ Not yet (Week 2)
  ThreadGraph.tsx       ❌ Not yet (Week 2)
workers/
  forceLayout.worker.ts ✅ D3 force simulation off-main-thread
styles/theme.css        ✅ Dark mode, color-blind-safe palette
.github/workflows/ci.yml ✅ Lint, type-check, test, build
tests/                  ✅ 126 tests across 12 files
tests/fixtures/         ✅ 6 Reddit JSON fixtures
```

### Next (Day 4+)
- Verify Reddit CORS from real browser (go/no-go gate)
- components/UrlInput.tsx — URL input with validation, loading states, error display
- lib/graphUtils.ts — nodeRadius, findNodeAtPoint, coordinate transforms
- components/ThreadGraph.tsx — Canvas rendering (Week 2 primary focus)
- app/page.tsx — state orchestration, component composition
- Client-side Reddit fetch hook

---

## 2026-03-28 — Week 2 Day 4: graphUtils + ThreadGraph + UrlInput

### Done
- `lib/graphUtils.ts`: Complete graph rendering utility library
  - nodeRadius(): score-based sizing with scoreHidden → median radius
  - sentimentColor(): color-blind-safe sentiment → color mapping
  - screenToGraph()/graphToScreen(): zoom-aware coordinate transforms
  - findNodeAtPoint(): quadtree-based hit-testing with zoom inversion
  - drawNode(): Canvas circle with sentiment color, dashed border for stubs
  - drawEdge(): Canvas line with highlight support
- `components/ThreadGraph.tsx`: Canvas-based force graph renderer
  - Worker integration: INIT on data load, FILTER on filter changes
  - Float32Array + nodeIds position decoding
  - Retina (devicePixelRatio) Canvas scaling
  - Centered coordinate system with zoom transform support
  - Selected node ring indicator
  - Empty state and "no matches" state
  - Simulation status indicator ("Laying out graph...")
- `components/UrlInput.tsx`: Two-phase URL input
  - Client-side validation (Reddit URL pattern, redd.it rejection)
  - Phase 1: GET cache check, Phase 2: browser Reddit fetch, Phase 3: POST process
  - Three loading states (idle/loading/loaded)
  - Error display (red for errors, orange for rate limits)
  - Post-load metadata bar (subreddit, comment count)
  - AbortController for request cancellation
- PR #4 review fixes (applied in prior session):
  - Float32Array nodeIds mapping, stack traces in errors, onTick/onEnd try-catch
  - 4 new tests (Float32Array, FILTER-before-INIT, focus trap Tab cycling)
- 34 new graphUtils tests (nodeRadius, sentimentColor, coordinate transforms, hit-testing, drawNode, drawEdge)
- Installed d3-zoom, d3-scale, d3-selection
- Test count: 130 → 164

### Git State
- Branch: develop (PR #4 merged)
- 164 tests passing, type-check clean, lint clean

### What's Built So Far
```
lib/
  types.ts              ✅ All core types (incl. nodeIds, stack on Worker msgs)
  errors.ts             ✅ Error classes with HTTP status mapping
  redis.ts              ✅ Singleton client with failure detection
  cache.ts              ✅ Upstash 15-min TTL
  rateLimiter.ts        ✅ Sliding window via @upstash/ratelimit
  sentiment.ts          ✅ AFINN scoring with preprocessing
  afinn.ts              ✅ AFINN-165 word list
  sanitize.ts           ✅ sanitize-html with entity decoding
  dataSource.ts         ✅ DataSource interface
  redditParser.ts       ✅ Full Reddit JSON parser
  redditJsonDataSource.ts ✅ DataSource impl
  graphUtils.ts         ✅ Node sizing, hit-testing, transforms, Canvas draw
app/
  page.tsx              ❌ State orchestration (next)
  layout.tsx            ✅ Dark mode, Geist fonts
  globals.css           ✅ Theme + all component styles
  api/health/route.ts   ✅ Redis status (auth-gated details)
  api/thread/route.ts   ✅ Two-phase API
components/
  ControlPanel.tsx      ✅ Depth slider, score filter, legend
  NodeDetail.tsx        ✅ Slide-out panel, focus trap
  UrlInput.tsx          ✅ Two-phase fetch, validation, loading states
  ThreadGraph.tsx       ✅ Canvas render + Worker integration
workers/
  forceLayout.worker.ts ✅ D3 force simulation + Float32Array + nodeIds
styles/theme.css        ✅ Dark mode, color-blind-safe palette
.github/workflows/ci.yml ✅ CI pipeline
tests/                  ✅ 164 tests across 13 files
tests/fixtures/         ✅ 6 Reddit JSON fixtures
```

### Next (Day 5)
- app/page.tsx — state orchestration, compose all components
- d3-zoom integration on ThreadGraph (pan/zoom with Canvas redraws)
- Click-to-select node → open NodeDetail
- Verify Reddit CORS from browser on preview deployment
