# Thread Cartographer -- Unified Build Plan v2

**Date:** 2026-03-27
**Status:** Active
**Supersedes:** `BUILD_PLAN_FULL_v1.md` (2026-03-26)
**PRD:** [`docs/decisions/DECISION-001-thread-cartographer-prd.md`](docs/decisions/DECISION-001-thread-cartographer-prd.md)
**AAP Verdict:** [`docs/decisions/DECISION-002-build-plan-v1-aap-verdict.md`](docs/decisions/DECISION-002-build-plan-v1-aap-verdict.md)

---

## Changelog from v1

This plan incorporates all 8 required changes and 5 recommended changes from the AAP verdict (DECISION-002). Key differences:

1. **Day 1 benchmarks** added: Vercel Hobby latency + DOMPurify serverless performance (RC#1, RC#5)
2. **ThreadGraph.tsx** expanded from 3 days to 5 days with graphUtils spec, Worker bundling plan, and main-thread fallback (RC#2)
3. **Test target** cut from ~125 to ~60 required tests; Canvas correctness via unit tests, not E2E (RC#3)
4. **Outbound Reddit rate awareness** added to `lib/redditFetch.ts` via `X-Ratelimit-Remaining` headers (RC#4)
5. **`/api/health` promoted** from stretch goal to required; Redis failure detection flag added (RC#6)
6. **Scope cuts** freeing ~4 buffer days: responsive layout, collapse/expand, Lighthouse CI automation, Docker Compose, standalone RUNBOOK (RC#7)
7. **Error state specification** added: HTTP status mapping + user-facing UI for all failure modes (RC#8)
8. **Sentiment preprocessing** added: strip URLs, quote blocks, markdown formatting before scoring (Rec#1)
9. **Test fixture capture** moved from Wednesday to Monday afternoon (Rec#2)
10. **Comment permalink test case** added to fixture and test plans (Rec#3)
11. **UrlInput loading states** specified: idle, loading, loaded with metadata bar (Rec#4)
12. **`score_hidden` handling** specified for node sizing: use median radius (Rec#5)
13. **Reddit rate limit** figure corrected and unified: ~100 requests per 600-second window, sustained ~6 req/min

---

## 1. PROJECT OVERVIEW

Thread Cartographer is an interactive web application that transforms Reddit thread URLs into force-directed graph visualizations, revealing the hidden topology of online conversations -- who replied to whom, where debate forks, where consensus forms, and where tangents live. Users paste a Reddit thread URL and receive a Canvas-rendered, D3-powered force-directed graph where nodes represent comments (sized by score, colored by AFINN sentiment using a color-blind-safe blue/gray/orange palette) and edges represent reply relationships. The application runs on Vercel (free tier), uses Upstash Redis for caching (15-minute TTL) and per-IP rate limiting (10 req/min), and caps visualization at 500 comment nodes with "load more" stubs for truncated branches. All Reddit data flows through a `DataSource` abstraction so the data source can be swapped within a day of refactoring. The force simulation runs in a Web Worker to keep the UI responsive, and all comment HTML is sanitized via DOMPurify before rendering.

**Realistic effort estimate (solo developer):**

| Track | Raw Effort | After Scope Cuts |
|-------|-----------|------------------|
| Frontend (UI/UX) | ~14 days | ~12 days |
| Backend (API/Data) | ~5 days | ~5 days |
| DBA (Redis/Cache) | ~2 days | ~2 days |
| DevOps (Infra/CI) | ~1.5 days | ~1.5 days |
| QA (Testing) | ~5 days | ~5 days |
| Benchmarks + Buffer | -- | ~4 days |
| **Total** | **~27.5 days** | **~29.5 days (incl. buffer)** |

A solo developer has ~16 effective coding days in a 4-week span (accounting for debugging, environment issues, learning curves, and context-switching overhead). The schedule below is designed around this reality, with interleaving across tracks and 4 buffer days distributed through Weeks 2-4.

**Key constraints:**

- **Reddit API:** ~100 requests per 600-second window (unauthenticated), sustained ~6 req/min. Undocumented `.json` endpoint could be restricted at any time.
- **500-node cap:** Threads exceeding 500 comments display top-level comments + 2 levels of replies. No recursive `/api/morechildren` fetching.
- **4-week timeline:** Hard time-box. Ship what exists at deadline.
- **$0/month cost:** Vercel Hobby plan, Upstash free tier (256 MB storage, 10K commands/day).
- **Vercel function timeout:** 10 seconds max on Hobby plan. Day 1 benchmark determines whether the processing pipeline fits within this constraint (see Section 3, Week 1).

---

## 2. DEPENDENCY MAP

### Component Dependency Graph

```
Upstash Redis Provisioning (DevOps)
    |
    v
lib/redis.ts (singleton client + failure detection flag)
    |
    +-- lib/cache.ts (DBA/Backend)
    |       |
    +-- lib/rateLimiter.ts (DBA/Backend)
    |       |
    v       v
lib/types.ts (Backend) <-- MUST BE FIRST CODE DELIVERABLE
    |
    +-- lib/errors.ts (Backend -- includes HTTP status mapping)
    +-- lib/sentiment.ts + lib/afinn.ts (Backend -- with URL/markdown stripping)
    +-- lib/sanitize.ts (Backend -- shared with Frontend)
    +-- lib/dataSource.ts (interface only)
    |
    v
lib/redditFetch.ts (Backend -- includes X-Ratelimit-Remaining awareness)
lib/redditParser.ts (Backend -- includes permalink URL normalization)
    |
    v
lib/redditJsonDataSource.ts (Backend -- depends on ALL above)
    |
    v
app/api/thread/route.ts (Backend -- depends on DataSource, cache, rateLimiter)
app/api/health/route.ts (Backend -- depends on redis.ts, cache.ts)
    |
    v
styles/theme.css (Frontend -- no deps, can start Day 1)
workers/forceLayout.worker.ts (Frontend -- depends on types.ts)
    |
    v
lib/graphUtils.ts (Frontend -- depends on types.ts; see Section 4 for spec)
    |
    v
components/ThreadGraph.tsx (Frontend -- depends on worker, graphUtils, theme)
    |
    +-- components/ControlPanel.tsx (can start Week 1 Fri against mock data)
    +-- components/NodeDetail.tsx   (can start Week 1 Fri against mock data)
    +-- components/UrlInput.tsx     (needs API route for integration)
    |
    v
app/page.tsx (Frontend -- orchestrates all components)
    |
    v
Accessibility audit + performance tuning (Frontend)
E2E tests (QA -- needs full UI + API)
Manual Lighthouse audit (QA)
Security hardening verification (DevOps)
```

### What Must Be Built First

1. **Day 1 benchmarks** -- Vercel Hobby latency + DOMPurify serverless performance (see Week 1 schedule)
2. **Upstash Redis provisioned** and environment variables set (DevOps, Day 1 morning)
3. **`lib/types.ts`** -- all other code depends on `CommentNode`, `ThreadEdge`, `ThreadData` types
4. **`lib/redis.ts`** -- singleton client with failure detection flag, used by cache and rate limiter
5. **`lib/cache.ts` + `lib/rateLimiter.ts`** -- infrastructure survival layer
6. **`styles/theme.css`** -- foundational CSS variables (can start in parallel with #3-5)
7. **Test fixtures** -- capture Monday afternoon to unblock parser development Tuesday

### Cross-Team Dependencies

| Provider | Deliverable | Consumer | Blocking? |
|----------|------------|----------|-----------|
| Backend | `lib/types.ts` | Everyone | Yes -- first deliverable |
| Backend | `lib/dataSource.ts` (interface) | Frontend (mock data development) | Yes |
| Backend | `app/api/thread/route.ts` | Frontend (`UrlInput` integration) | Yes for integration, No for mock dev |
| Backend | `lib/sanitize.ts` | Frontend (`NodeDetail`) | Yes |
| Backend | Mock `ThreadData` fixtures | Frontend, QA | Yes for realistic development |
| DevOps | Upstash credentials + `.env.example` | Backend, DBA | Yes |
| DevOps | Vercel project + CI pipeline | All (preview deploys) | No for local dev, Yes for integration testing |
| DevOps | Day 1 benchmark results | Backend (sanitization strategy) | Yes -- determines server vs client sanitization |
| Frontend | Next.js project skeleton on GitHub | DevOps (Vercel link, CI) | Yes |
| Frontend | `package.json` with lint/test/build scripts | DevOps (CI pipeline) | Yes |
| Frontend | `app/layout.tsx` | DevOps (Speed Insights) | Yes |
| QA | Test fixtures in `tests/fixtures/` | Backend (parser tests) | Yes -- moved to Day 1 |

### Critical Path

```
Day 1: types.ts + redis.ts + theme.css + Upstash provisioning + benchmarks + fixture capture
    |
Day 2-3: cache.ts + rateLimiter.ts + sentiment.ts + sanitize.ts + ControlPanel + NodeDetail (mock)
    |
Day 3-5: redditFetch.ts + redditParser.ts + redditJsonDataSource.ts + forceLayout.worker.ts
    |
Day 5-6: api/thread/route.ts + api/health/route.ts + UrlInput + unit tests
    |
Day 6-10: ThreadGraph.tsx (full 5-day allocation) + graphUtils.ts
    |                      Fallback checkpoint: Wed Day 8 -- if Worker unstable, drop to main thread
    |
Day 10-12: page.tsx integration + CI pipeline + security headers + integration tests
    |
Day 12-14: E2E tests (5 happy-path) + keyboard navigation + accessibility
    |
Day 14-16: Bug fixes + manual Lighthouse audit + manual security audit
    |
Day 16-18: Production deploy + post-deploy verification
    |
Day 18-20: Buffer (distributed) -- absorbed into schedule as needed
```

---

## 3. WEEK-BY-WEEK BUILD SCHEDULE

### Week 1: Foundation + Infrastructure + Data Pipeline + Benchmarks

**Goal:** All infrastructure operational. Day 1 benchmarks determine sanitization strategy. Reddit fetch/parse pipeline working end-to-end in isolation. ControlPanel and NodeDetail prototypes built against mock data. Web Worker skeleton compiling.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon AM | `lib/types.ts`, `lib/errors.ts`, `lib/redis.ts`, `.env.example`, `.env.local`, `styles/theme.css`, `vercel.json`, `.vercelignore` | Backend + DevOps + Frontend |
| Mon AM | Provision Upstash Redis, create Vercel project, link GitHub repo | DevOps |
| Mon PM | **Day 1 Benchmark:** Deploy minimal Vercel function that fetches Reddit `.json`, runs DOMPurify sanitization on 100 comments, writes to Upstash. Measure cold-start and warm-start latency. Document results in `build_log.md`. | DevOps + Backend |
| Mon PM | `tests/fixtures/reddit/*.json` -- capture 5-6 real Reddit thread responses (including one comment permalink URL) | QA |
| Tue | `lib/cache.ts`, `lib/rateLimiter.ts`, `lib/sanitize.ts` (strategy determined by benchmark) | Backend/DBA |
| Tue | `lib/sentiment.ts` (with URL/quote/markdown stripping), `lib/afinn.ts` | Backend |
| Tue | `workers/forceLayout.worker.ts` (skeleton + message protocol) | Frontend |
| Wed | `lib/redditFetch.ts` (with `X-Ratelimit-Remaining` header reading), `lib/redditParser.ts` (with permalink normalization) | Backend |
| Wed | `tests/mocks/redisClient.mock.ts`, `tests/mocks/fetchMock.ts` | QA |
| Thu | `lib/redditJsonDataSource.ts`, `lib/dataSource.ts` | Backend |
| Thu | `tests/lib/fixtureDataSource.ts` | Backend |
| Thu | Unit tests: `sentiment.test.ts`, `cache.test.ts`, `rateLimiter.test.ts`, `sanitize.test.ts`, `redditParser.test.ts` (including permalink normalization case) | QA/Backend |
| Fri | `app/api/thread/route.ts`, `app/api/health/route.ts` | Backend |
| Fri | `components/ControlPanel.tsx` (against mock data -- depth slider, score threshold, legend) | Frontend |
| Fri | `components/NodeDetail.tsx` (against mock data -- slide-out panel, keyboard focus trap) | Frontend |
| Fri | `.github/workflows/ci.yml` | DevOps |

#### Day 1 Benchmark Protocol

Deploy a minimal Vercel function (`app/api/benchmark/route.ts` -- temporary, deleted after) that:

1. Fetches `https://www.reddit.com/r/AskReddit/comments/t0ynr/.json` (large thread)
2. Parses the JSON and extracts 100 `body_html` strings
3. Runs `isomorphic-dompurify` sanitization on all 100
4. Writes a test key to Upstash Redis
5. Returns timing for each step

**Decision matrix based on benchmark results:**

| Warm-start total | Strategy |
|-----------------|----------|
| **< 5 seconds** | Proceed as planned: server-side DOMPurify, cache fully-processed `ThreadData` |
| **5-7 seconds** | Switch to `sanitize-html` (lighter, no jsdom). Re-benchmark to confirm improvement. |
| **> 7 seconds** | Move sanitization client-side. Cache stores parsed but unsanitized `ThreadData` with `sanitized: false` flag. `NodeDetail.tsx` runs DOMPurify in-browser before rendering `bodyHtml`. |

Also verify during this benchmark:
- Web Worker bundling: `new Worker(new URL('./worker.ts', import.meta.url))` works in Vercel deployment
- CSP does not block Worker: `worker-src 'self'` is present

#### What Gets Tested

- All `lib/` modules have unit tests
- Cache get/set with TTL verification
- Rate limiter: 10 requests allowed, 11th blocked
- URL validation: Reddit URLs accepted, non-Reddit rejected
- Reddit parser against fixture JSON: correct node/edge counts, stub handling, 500-cap
- **Permalink normalization: comment-scoped URL stripped to thread-level URL**
- Sentiment scoring: positive/negative/neutral classification (with URL/markdown stripping)
- Sanitization: XSS vectors stripped, formatting preserved
- **`X-Ratelimit-Remaining` header parsing in `redditFetch.ts`**
- CI pipeline green on first run

#### What Gets Deployed

- Vercel preview deployment with skeleton Next.js app
- API route functional on preview URL (testable via curl)
- `/api/health` returning Redis status

#### Definition of Done (Week 1)

- [ ] Day 1 benchmark completed and sanitization strategy documented in `build_log.md`
- [ ] Web Worker bundling verified on Vercel deployment
- [ ] `curl /api/thread?url=<reddit_url>` returns valid `ThreadData` JSON
- [ ] `curl /api/health` returns Redis ping status and cache hit/miss counts
- [ ] Cache hit on repeated request within 15 minutes (verified via response header `X-Cache: HIT`)
- [ ] 11th request from same IP returns 429 with `Retry-After` header
- [ ] Non-Reddit URL returns 400 with error message
- [ ] Comment permalink URL returns full thread data (not subtree)
- [ ] All unit tests pass in CI
- [ ] Web Worker skeleton compiles and responds to INIT message with mock positions
- [ ] ControlPanel and NodeDetail render against mock data on preview deployment

#### Risks/Blockers

- **Day 1 benchmark reveals >7s latency:** Triggers client-side sanitization strategy. Adds ~0.5 days to NodeDetail implementation but is absorbed by Week 1 Friday schedule.
- **Reddit API changes since fixtures were captured:** Mitigated by capturing fresh fixtures on Day 1 Monday afternoon.
- **Upstash provisioning delays:** Code can be developed with no-op cache fallback (already specified in Section 9.5).

---

### Week 2: ThreadGraph + Frontend Integration

**Goal:** Force-directed graph renders real Reddit data. ThreadGraph is the full-week focus. Pan/zoom working. UrlInput integrated with API. All major UI components functional.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | `lib/graphUtils.ts` (quadtree, coordinate transforms, hit-testing, node sizing -- see Section 4 spec) | Frontend |
| Mon-Fri | `components/ThreadGraph.tsx` (5-day allocation -- see phased approach below) | Frontend |
| Tue | `components/UrlInput.tsx` (validation, loading states, error display, metadata bar) | Frontend |
| Thu | `app/page.tsx` (state orchestration, component composition) | Frontend |
| Thu | `app/layout.tsx` (metadata, font loading, theme import, Speed Insights) | Frontend |
| Fri | `next.config.ts` (security headers, CSP including `worker-src 'self'`) | DevOps |
| Fri | Integration tests: `tests/api/thread.route.test.ts` | QA |

#### ThreadGraph.tsx -- Phased Build (5 Days)

This is the most complex component. Build incrementally with a hard fallback checkpoint.

| Day | Milestone | What Works |
|-----|-----------|------------|
| **Mon** | Static Canvas render | Nodes drawn at hardcoded positions. Colors and sizes correct. No interaction. |
| **Tue** | d3-zoom integration | Pan/zoom with correct coordinate transforms. Canvas redraws on zoom. |
| **Wed** | Force simulation (main thread) | D3 force simulation running on main thread with `requestAnimationFrame`. Nodes settle into force layout. **FALLBACK CHECKPOINT: if this works but Worker integration looks risky, ship main-thread simulation.** |
| **Thu** | Web Worker integration | Simulation moves to Worker. `Float32Array` transfers for >200 nodes. Main thread only handles rendering + zoom. |
| **Fri** | Hit-testing + interaction | Quadtree-based click/hover detection. Click opens NodeDetail. Hover shows tooltip. Filter messages (FILTER) sent to Worker on depth/score change. |

**Fallback rule:** If Web Worker + Canvas integration is not stable by end of Wednesday, fall back to main-thread simulation with `requestAnimationFrame` throttling and a 300-tick cap. The Worker can be re-added in Week 4 buffer if time permits. Main-thread simulation is acceptable for 500 nodes with Canvas rendering -- the 300-tick cap ensures the long task completes in <2 seconds.

#### UrlInput Loading States

`components/UrlInput.tsx` implements three states:

| State | UI |
|-------|------|
| **Idle** | Empty text field with placeholder: "Paste a Reddit thread URL..." |
| **Loading** | Input disabled, spinner icon, text: "Fetching thread..." |
| **Loaded** | Metadata bar below input: subreddit name, "Showing {N} of {total} comments", cache freshness ("fetched 3 min ago" or "live"), thread title |
| **Error** | See Error State Specification (Section 5) |

#### What Gets Tested

- ThreadGraph renders 500 nodes without frame drops (manual verification)
- Pan/zoom smooth on desktop (manual verification)
- Node click opens detail panel with correct comment data
- Depth slider and score filter dynamically update visible nodes
- URL input validates, submits, shows loading state, displays error on failure
- Integration tests: full request flow with mocked Redis and Reddit
- Security headers present on preview deployment
- **Canvas draw functions: unit tests with mocked `CanvasRenderingContext2D`**

#### What Gets Deployed

- Preview deployment with functional graph visualization
- Testable end-to-end: paste URL, see graph, click nodes, use filters

#### Definition of Done (Week 2)

- [ ] Paste a Reddit URL --> graph renders within 10 seconds (uncached)
- [ ] Cached request renders within 5 seconds
- [ ] Nodes sized by score, colored by sentiment (blue/gray/orange)
- [ ] **Nodes with `score_hidden: true` use median radius (neutral sizing)**
- [ ] Pan/zoom with mouse wheel and drag
- [ ] Click node --> detail panel shows author, score (or "score hidden"), sanitized body, permalink
- [ ] Depth slider hides nodes beyond selected depth
- [ ] Score threshold hides nodes below selected score
- [ ] Color legend visible in control panel
- [ ] All integration tests pass in CI
- [ ] **ThreadGraph fallback decision documented** (Worker or main-thread)

#### Risks/Blockers

- **ThreadGraph is the most complex component** (full week allocation). The phased approach and Wednesday fallback checkpoint mitigate schedule risk.
- **d3-zoom + Canvas coordinate transforms** require correct inversion for hit-testing. The `graphUtils.ts` spec (Section 4) addresses this explicitly.
- **CSP may block Web Worker.** Mitigated by adding `worker-src 'self'` to CSP and verifying during Day 1 benchmark.

---

### Week 3: Integration, Accessibility, Testing, Polish

**Goal:** Full end-to-end flow polished. Keyboard navigation complete. E2E tests written. All acceptance criteria passing.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | Keyboard navigation wiring (Tab order, Enter/Escape for panels) | Frontend |
| Mon | Focus trap for NodeDetail panel, ARIA labels on all controls | Frontend |
| Tue | E2E tests: `tests/e2e/happy-path.spec.ts` (paste URL, see graph, click node, use filter, keyboard nav) | QA |
| Tue | Canvas correctness unit tests: `tests/lib/graphUtils.test.ts`, `tests/lib/threadGraph.render.test.ts` | QA |
| Wed | `tests/api/thread.route.test.ts` (remaining integration tests), `tests/api/health.route.test.ts` | QA |
| Wed | Error boundary components around ThreadGraph and NodeDetail | Frontend |
| Thu | Bug fixes from testing | All |
| Thu | `playwright.config.ts` | QA |
| Fri | **Buffer day** -- absorb slippage from Weeks 1-2. If on track: additional E2E tests for error states. | All |

#### Scope Cuts (from v1)

The following items are **removed from Phase 1 scope** per AAP verdict:

- ~~Responsive/mobile layout (drawer behavior for ControlPanel, full-width NodeDetail on mobile)~~ — App must not crash on mobile viewport, but no responsive optimization.
- ~~Collapse/expand branch logic~~ — Deferred to Phase 1.1. Depth slider and score filter provide sufficient branch filtering.
- ~~Lighthouse CI automation (`lighthouserc.js`)~~ — Run Lighthouse manually instead.
- ~~`tests/e2e/performance.spec.ts`~~ — Performance verified via manual Lighthouse audit.
- ~~Visual regression testing setup~~ — Deferred to Phase 2.

#### What Gets Tested

- 5 happy-path E2E tests against fixture data
- Keyboard navigation: Tab through all controls, Enter opens detail, Escape closes
- ARIA labels verified via Playwright assertions
- Canvas draw function correctness via mocked `CanvasRenderingContext2D`
- Hit-testing correctness via unit tests (given coordinates, returns correct node)
- Lighthouse performance >= 80, accessibility >= 70 (manual audit)
- Error boundary catches rendering crashes gracefully

#### What Gets Deployed

- Preview deployment with complete feature set
- Pre-promotion testing checklist executed against preview

#### Definition of Done (Week 3)

- [ ] All 10 acceptance criteria pass (see Section 10)
- [ ] Required E2E tests pass in CI
- [ ] Lighthouse performance >= 80 with 500-comment thread (manual)
- [ ] Lighthouse accessibility >= 70 (manual)
- [ ] Tab/Enter/Escape keyboard navigation functional
- [ ] Detail panel focus-trapped when open
- [ ] App does not crash on mobile viewport
- [ ] No console errors on clean page load
- [ ] Error boundaries catch and display fallback UI for rendering crashes

#### Risks/Blockers

- **Canvas keyboard navigation is inherently complex.** Index-based node traversal (not spatial) is the pragmatic approach for Phase 1.
- **Lighthouse 80 on performance may be tight** with D3 + Web Worker JS bundle. Mitigation: lazy-load D3 modules via `next/dynamic`.
- **Week 1-2 slippage** absorbed by Friday buffer day.

---

### Week 4: Production Hardening + Launch

**Goal:** Production deployment. All tests green. Documentation complete. Monitoring baseline established.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | Performance optimization: lazy loading, bundle analysis, Float32Array transfers | Frontend |
| Mon | Rate limit integration test (`tests/api/rateLimit.test.ts`) | QA |
| Tue | Manual security tests (URL injection, SSRF, XSS, rate limit bypass) | QA |
| Tue | Manual accessibility audit (VoiceOver, color-blind sim, 200% zoom) | QA |
| Wed | Bug fixes from testing | All |
| Wed | Rollback procedure section in README.md | DevOps |
| Thu | Final Lighthouse audit, fix any regressions | Frontend |
| Thu | Production deployment: merge `develop` to `main` | All |
| Fri | Post-deploy verification, monitoring baseline | All |
| **Sat-Sun** | **Buffer** -- available if Thu deploy reveals issues | -- |

#### What Gets Tested

- Full manual security test matrix (7 scenarios)
- Full manual accessibility audit (4 checks)
- Pre-promotion checklist against preview deployment
- Post-deploy smoke test against production URL
- Upstash dashboard: cache hit rate, command usage, memory
- `/api/health` returns healthy status on production

#### What Gets Deployed

- **Production deployment** to `main` branch
- Production URL: `thread-cartographer.vercel.app` (or similar)

#### Definition of Done (Week 4)

- [ ] All acceptance criteria pass on production URL
- [ ] No 500 errors in Vercel Runtime Logs for 24 hours post-deploy
- [ ] Cache hit rate trending toward 70% (requires real usage)
- [ ] `/api/health` returns healthy on production
- [ ] Rollback procedure documented in README.md
- [ ] Zero open-relay incidents (no non-Reddit domains proxied)

#### Risks/Blockers

- **Last-minute bug cascade.** Mitigation: freeze features by Wednesday. Thursday/Friday are deploy + verify only.
- **Reddit endpoint instability** during launch week. Mitigation: cache preserves recently-fetched data; error messages are clear.

---

## 4. TECHNICAL DECISIONS SUMMARY

| Decision | Choice | Rationale | Source |
|----------|--------|-----------|--------|
| **Rendering** | HTML Canvas (not SVG) | 500 nodes = ~1500 SVG DOM elements vs 1 Canvas element. Canvas wins on frame rate, memory (2-5 MB vs 15-30 MB), and zoom/pan performance. Trade-off: manual hit-testing via quadtree. | Frontend |
| **Web Worker strategy** | D3 force simulation in dedicated Worker; positions sent as `Float32Array` (transferable) for >200 nodes, plain JSON below. **Fallback: main-thread simulation with rAF throttling if Worker unstable by Week 2 Wednesday.** | Keeps main thread free of long tasks. Transferable ArrayBuffers avoid structured clone overhead at scale. | Frontend + AAP |
| **Web Worker bundling** | `new Worker(new URL('./worker.ts', import.meta.url))` (webpack 5 native syntax) | Works with Next.js default bundler. Verified during Day 1 benchmark on Vercel deployment. No external loader needed. | AAP RC#2 |
| **Sentiment analysis** | AFINN-165 word list, server-side scoring during parse. **Preprocessing: strip URLs (regex), Reddit quote blocks (lines starting with `>`), and markdown formatting (`**`, `*`, `~~`, `[text](url)`) before scoring.** | Zero-cost, deterministic, no API calls. Preprocessing improves accuracy by removing non-sentiment text. Scored against `body` (raw markdown, post-stripping), not `body_html`. Normalization: `score / (|score| + 5)` damping to prevent short-comment dominance. | Backend + AAP Rec#1 |
| **Sentiment thresholds** | Positive: > 0.2, Neutral: -0.2 to 0.2, Negative: < -0.2 | Wide neutral band acknowledges AFINN limitations on Reddit text (sarcasm, slang). | Backend |
| **Redis protocol** | Upstash REST API (`@upstash/redis`) exclusively | Serverless-native: no TCP connections, no pool exhaustion, no cold-start handshake overhead. Unlimited connections on free tier. | DBA + DevOps |
| **Redis failure detection** | In-memory failure counter in `lib/redis.ts`. After 3 consecutive failures, set `degraded` flag. Flag resets on next successful operation. API route returns `X-Degraded: cache` header when flag is set. | Prevents silent degradation where dead Redis causes every request to hammer Reddit. Not a full circuit breaker -- just a signal. | AAP RC#6 |
| **Cache key design** | `tc:cache:thread:<thread_id>` (e.g., `tc:cache:thread:t0ynr`) | Key by thread ID, not full URL. Short, collision-free, handles all URL variations (old.reddit, www, .json suffix, query params). | DBA |
| **Cache content** | Fully parsed `ThreadData` (post-sentiment, post-sanitize). **Exception: if Day 1 benchmark triggers client-side sanitization, cache stores unsanitized data with `sanitized: false` flag.** | Cache hits skip parsing, sanitizing, and scoring. ~300-630 KB per 500-comment thread. | Backend + AAP RC#1 |
| **Rate limit algorithm** | `@upstash/ratelimit` with sliding window (10 req/min) | Battle-tested, 3-line setup, avoids 2x boundary burst issue of fixed window. | Backend |
| **Outbound Reddit rate awareness** | `lib/redditFetch.ts` reads `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` from Reddit response headers. Logs values. Returns 503 with `Retry-After` if remaining drops to 0. Logs warning if remaining < 5. | Prevents Vercel IP from being blocked by Reddit. Lightweight -- no Redis-backed tracker needed for Phase 1. | AAP RC#4 |
| **URL normalization** | Strip query params, hash, trailing slashes, `.json` suffix. Replace all Reddit hostname variants with canonical. Extract thread ID. **Strip comment ID segment from permalink URLs** (e.g., `.../comments/abc123/title/def456/` → `.../comments/abc123/`). | Ensures all URL variants for the same thread hit the same cache key. Prevents partial-thread caching from permalink URLs. | DBA + Reddit + AAP Rec#3 |
| **Sanitization library** | `isomorphic-dompurify` (allowlist-based). **Decision confirmed or changed by Day 1 benchmark. Fallbacks: (a) `sanitize-html`, (b) client-side DOMPurify.** | DOMPurify is the industry standard. Day 1 benchmark determines whether jsdom overhead is acceptable on Vercel Hobby serverless. | Backend + AAP RC#5 |
| **`body_html` handling** | Use Reddit's pre-rendered `body_html`, decode HTML entities, then sanitize via DOMPurify | Avoids adding a markdown parser dependency. Reddit's double-encoding must be decoded first. Use `body` (raw markdown) for sentiment analysis. | Backend + Reddit |
| **State management** | React `useState` + `useReducer` at `page.tsx` level | State graph is shallow (thread data, filter state, selected node). No external state library needed for Phase 1. | Frontend |
| **D3 imports** | Individual modules: `d3-force`, `d3-zoom`, `d3-scale`, `d3-selection`, `d3-quadtree` | Avoids importing full `d3` bundle (~100 KB). Individual modules total ~40 KB gzipped. | Frontend |
| **ID normalization** | Strip `t1_`/`t3_` prefix from Reddit IDs; use bare ID as canonical | `parent_id` references use prefixed format; node IDs use bare format. Must strip consistently. | Backend + Reddit |
| **Fail-open on Redis errors** | If Redis is unreachable, allow request through (skip cache, skip rate limit). **Log the error. Set degraded flag after 3 consecutive failures. Return `X-Degraded: cache` header.** | Blocking all users because Redis is down is worse than briefly losing rate limiting/caching. Degraded flag provides observability. | Backend + DBA + AAP RC#6 |
| **API method** | `GET /api/thread?url={encoded_url}` | Thread fetching is idempotent and cacheable. GET aligns with HTTP semantics. | Backend |
| **IP extraction** | `x-forwarded-for` (Vercel-set), fallback to `x-real-ip`, then constant for localhost | Vercel provides reliable IP via these headers. | Backend + DevOps |
| **Dark mode** | Dark background as default and only mode. No light mode toggle. | PRD mandates "dark background with light nodes as default." | Frontend |
| **Short URLs (`redd.it`)** | Reject with helpful error message | Short URLs require HTTP redirect follow. Phase 1 rejects with "Please use the full Reddit thread URL." | Reddit |
| **`score_hidden` handling** | When `score_hidden: true`, detail panel displays "score hidden" instead of "1". **Node sizing uses median node radius (neutral/default size) rather than computing from score.** | Reddit returns `score: 1` for hidden scores regardless of actual value. Computing size from this fake value would be misleading. | AAP Rec#5 |

### `lib/graphUtils.ts` Specification

This file contains the hardest non-obvious code in the frontend. Specification required before implementation.

#### Node Radius Calculation

```typescript
function nodeRadius(score: number, scoreHidden: boolean, allScores: number[]): number
```

- If `scoreHidden` is true, return median radius of all non-hidden nodes (neutral sizing).
- Otherwise: `MIN_RADIUS + (score - minScore) / (maxScore - minScore) * (MAX_RADIUS - MIN_RADIUS)`
- `MIN_RADIUS = 4`, `MAX_RADIUS = 20` (CSS variables, overridable via theme)
- Clamp to `[MIN_RADIUS, MAX_RADIUS]`

#### Quadtree Hit-Testing

```typescript
function findNodeAtPoint(
  x: number, y: number,
  nodes: SimulationNode[],
  transform: d3.ZoomTransform
): SimulationNode | null
```

- Build `d3-quadtree` from current node positions
- **Invert the zoom transform** to convert screen coordinates (click event) to simulation coordinates: `const [sx, sy] = transform.invert([x, y])`
- Search quadtree with radius equal to `MAX_RADIUS` to find candidate nodes
- For each candidate, check if distance from `(sx, sy)` to node center is less than `nodeRadius(node)`
- Return closest match or `null`

#### Screen-to-Graph Coordinate Transform

```typescript
function screenToGraph(screenX: number, screenY: number, transform: d3.ZoomTransform): [number, number]
function graphToScreen(graphX: number, graphY: number, transform: d3.ZoomTransform): [number, number]
```

- `screenToGraph`: `transform.invert([screenX, screenY])` — converts mouse/touch coordinates to simulation space
- `graphToScreen`: `transform.apply([graphX, graphY])` — converts simulation coordinates to canvas pixel coordinates
- All Canvas draw calls use `graphToScreen` (or apply the transform to the canvas context via `ctx.setTransform`)

#### Canvas Draw Helpers

```typescript
function drawNode(ctx: CanvasRenderingContext2D, node: SimulationNode, transform: d3.ZoomTransform): void
function drawEdge(ctx: CanvasRenderingContext2D, source: SimulationNode, target: SimulationNode, transform: d3.ZoomTransform): void
```

- These are the functions tested via mocked `CanvasRenderingContext2D` in unit tests
- `drawNode` calls `ctx.beginPath()`, `ctx.arc(...)`, `ctx.fill()` with the sentiment color and computed radius
- `drawEdge` calls `ctx.beginPath()`, `ctx.moveTo(...)`, `ctx.lineTo(...)`, `ctx.stroke()`
- Both apply zoom transform to coordinates before drawing

---

## 5. ERROR STATE SPECIFICATION

### API Error Mapping

| Error Class | HTTP Status | Response Body |
|-------------|-------------|---------------|
| `ValidationError` | 400 | `{ error: "INVALID_URL", message: "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)" }` |
| `ValidationError` (short URL) | 400 | `{ error: "SHORT_URL", message: "Please use the full Reddit thread URL, not a redd.it short link." }` |
| `RateLimitError` | 429 | `{ error: "RATE_LIMITED", message: "Too many requests.", retryAfter: N }` + `Retry-After` header |
| `RedditApiError` (403/451) | 502 | `{ error: "THREAD_INACCESSIBLE", message: "This thread is not accessible. It may be private, quarantined, or geo-restricted." }` |
| `RedditApiError` (5xx) | 502 | `{ error: "REDDIT_UNAVAILABLE", message: "Reddit is temporarily unavailable. Try again in a few minutes." }` |
| `RedditApiError` (rate limited by Reddit) | 503 | `{ error: "REDDIT_RATE_LIMITED", message: "Reddit rate limit reached. Try again shortly.", retryAfter: N }` + `Retry-After` header |
| `UpstreamError` (timeout) | 504 | `{ error: "TIMEOUT", message: "This thread took too long to load. Try a smaller thread or try again." }` |
| Unhandled exception | 500 | `{ error: "INTERNAL", message: "Something went wrong. Please try again." }` |

### User-Facing Error UI

| Condition | Where | What User Sees |
|-----------|-------|----------------|
| Invalid URL / non-Reddit | Below URL input (inline) | Red text: "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)" |
| Short URL (`redd.it`) | Below URL input (inline) | Red text: "Please use the full Reddit thread URL, not a redd.it short link." |
| Rate limited (429) | Below URL input (inline) | Orange text: "Too many requests. Please wait {N} seconds." with countdown timer |
| Thread inaccessible (403/451) | Graph area (centered) | Icon + "This thread is not accessible. It may be private, quarantined, or geo-restricted." |
| Reddit unavailable (5xx) | Graph area (centered) | Icon + "Reddit is temporarily unavailable. Try again in a few minutes." + Retry button |
| Request timeout (504) | Graph area (centered) | Icon + "This thread took too long to load. Try a smaller thread." |
| Empty thread (0 comments) | Graph area (centered) | Single root node + text: "This thread has no comments yet." |
| Worker crash | Graph area (centered) | "Visualization failed to load. Refresh to try again." + console.error with stack trace |
| Canvas rendering error | Graph area (centered) | React Error Boundary catches: "Something went wrong displaying the graph. Refresh to try again." |
| Redis unavailable | Not user-visible | `X-Degraded: cache` response header. Structured log warning. Request proceeds without caching/rate-limiting. |
| Internal server error | Graph area (centered) | "Something went wrong. Please try again." |

---

## 6. FILE MANIFEST

### `lib/` -- Core Logic

| File | Purpose |
|------|---------|
| `lib/types.ts` | `CommentNode`, `ThreadEdge`, `ThreadData`, `FilterState`, `SimulationNode`, and other shared TypeScript interfaces (per PRD Section 4.4). Includes `scoreHidden: boolean` on `CommentNode`. |
| `lib/dataSource.ts` | `DataSource` interface: `fetchThread(url)`, `isValidUrl(url)` |
| `lib/redditJsonDataSource.ts` | `RedditJsonDataSource` class implementing `DataSource`. Orchestrates cache check, fetch, parse, sentiment score, sanitize, cache write. |
| `lib/redditFetch.ts` | `fetchRedditJson(url)` -- HTTP request to Reddit `.json` endpoint with User-Agent, retries, error classification. **Reads `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` headers. Returns 503 if remaining is 0.** |
| `lib/redditParser.ts` | `parseRedditResponse(raw)` -- converts nested Reddit JSON tree into flat `CommentNode[]` + `ThreadEdge[]`. Handles `"more"` stubs, 500-cap, deleted comments. **Normalizes permalink URLs by stripping comment ID segment.** |
| `lib/cache.ts` | `ThreadCache` class: `get(key)`, `set(key, data)`, `normalizeThreadUrl(url)`. Upstash Redis with 15-min TTL. Hit/miss counters. |
| `lib/redis.ts` | Singleton `Redis.fromEnv()` client instance shared by cache and rate limiter. **Includes failure counter and `isDegraded()` method. Resets on successful operation.** |
| `lib/rateLimiter.ts` | Per-IP rate limiting via `@upstash/ratelimit` sliding window. Returns `RateLimitResult`. |
| `lib/sentiment.ts` | `scoreSentiment(text)` -- AFINN-based scoring, returns normalized [-1, 1] value. **Preprocessing: strips URLs, quote blocks, and markdown formatting before scoring.** |
| `lib/afinn.ts` | AFINN-165 word list as `Record<string, number>` (or re-export from `afinn-165` package) |
| `lib/sanitize.ts` | `sanitizeHtml(html)` -- DOMPurify wrapper with allowlisted tags/attributes. **Implementation determined by Day 1 benchmark (server-side DOMPurify, sanitize-html, or client-side flag).** |
| `lib/errors.ts` | Custom error classes: `ValidationError`, `RateLimitError`, `UpstreamError`, `RedditApiError`. **Each class includes a `toHttpResponse()` method returning `{ status, body }` per Section 5 mapping.** |
| `lib/graphUtils.ts` | **Specified in Section 4:** `nodeRadius()`, `findNodeAtPoint()`, `screenToGraph()`, `graphToScreen()`, `drawNode()`, `drawEdge()`. Quadtree-based hit-testing with zoom transform inversion. |

### `app/` -- Next.js Routes and Pages

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main page: URL input + visualization container, state orchestration via `useReducer` |
| `app/layout.tsx` | Root layout: metadata, font loading, theme CSS import, `<SpeedInsights />` |
| `app/globals.css` | Tailwind base + custom global styles, theme.css import |
| `app/api/thread/route.ts` | `GET` handler: validates URL, checks rate limit, delegates to DataSource, returns `ThreadData` JSON. **Maps error classes to HTTP statuses per Section 5. Returns `X-Degraded: cache` header when Redis is in degraded state.** |
| `app/api/health/route.ts` | **Required.** Returns: Redis reachability (ping), cache hit/miss counts since deploy, degraded flag status, uptime. |

### `components/` -- React Components

| File | Purpose |
|------|---------|
| `components/ThreadGraph.tsx` | Canvas-rendered force-directed graph. Client component. Manages Web Worker (or main-thread fallback), d3-zoom, hit-testing, hover/click. **Wrapped in Error Boundary.** |
| `components/ControlPanel.tsx` | Left-side panel: depth slider, score threshold, color legend. **(Collapse/expand deferred to Phase 1.1.)** |
| `components/NodeDetail.tsx` | Right-side slide-out panel: comment text (sanitized), author, score (or "score hidden"), depth, permalink. Focus-trapped. |
| `components/UrlInput.tsx` | URL text field with validation, three loading states (idle/loading/loaded), error display per Section 5, post-fetch metadata bar. |
| `components/ErrorFallback.tsx` | Error boundary fallback UI for ThreadGraph and NodeDetail rendering crashes. |
| `components/GraphError.tsx` | Centered error display for graph area (timeout, inaccessible thread, empty thread, etc.). |
| `components/DataTable.tsx` | *(Stretch goal)* Sortable HTML table alternative to the graph view |

### `workers/` -- Web Workers

| File | Purpose |
|------|---------|
| `workers/forceLayout.worker.ts` | D3 force simulation off-main-thread. Receives INIT/FILTER/STOP messages, posts TICK/STABILIZED/ERROR. **Bundled via `new Worker(new URL('./worker.ts', import.meta.url))`.** |

### `styles/` -- Theming

| File | Purpose |
|------|---------|
| `styles/theme.css` | CSS custom properties: dark mode palette, color-blind-safe sentiment colors, sizing variables (including `--node-min-radius`, `--node-max-radius`) |

### `tests/` -- Test Infrastructure

| File | Purpose |
|------|---------|
| `tests/fixtures/reddit/small-thread.json` | ~50 comments, full tree, happy path |
| `tests/fixtures/reddit/large-thread.json` | ~600 comments, triggers 500-cap |
| `tests/fixtures/reddit/deleted-comments.json` | `[deleted]`/`[removed]` comments |
| `tests/fixtures/reddit/more-stubs.json` | `"kind": "more"` objects in children |
| `tests/fixtures/reddit/malformed-response.json` | Invalid/unexpected JSON structure |
| `tests/fixtures/reddit/xss-comments.json` | Comments with script tags, event handlers |
| `tests/fixtures/reddit/empty-thread.json` | Thread with zero comments |
| `tests/fixtures/reddit/comment-permalink.json` | **Response from a comment permalink URL (subtree, not full thread)** |
| `tests/fixtures/README.md` | Documents each fixture's source URL and capture date |
| `tests/mocks/redisClient.mock.ts` | In-memory Map-based Redis mock with TTL simulation |
| `tests/mocks/fetchMock.ts` | Fetch mock returning fixture data by URL pattern |
| `tests/mocks/canvasContext.mock.ts` | **Mocked `CanvasRenderingContext2D` for draw function unit tests** |
| `tests/lib/fixtureDataSource.ts` | `FixtureDataSource` implementing `DataSource` with static JSON |
| `tests/lib/sentiment.test.ts` | Sentiment scoring unit tests **(including URL/markdown stripping verification)** |
| `tests/lib/cache.test.ts` | Cache get/set/key-normalization unit tests |
| `tests/lib/rateLimiter.test.ts` | Rate limiter unit tests |
| `tests/lib/sanitize.test.ts` | HTML sanitization unit tests |
| `tests/lib/redditParser.test.ts` | Parser unit tests **(including permalink normalization: `test_normalizeUrl_commentPermalink_stripsCommentId`)** |
| `tests/lib/redditFetch.test.ts` | **Fetch unit tests including `X-Ratelimit-Remaining` header parsing** |
| `tests/lib/redditJsonDataSource.test.ts` | DataSource integration tests against all fixtures |
| `tests/lib/graphUtils.test.ts` | **Hit-testing, coordinate transforms, node radius calculation. Uses mocked Canvas context.** |
| `tests/lib/threadGraph.render.test.ts` | **Canvas draw function correctness: `drawNode` called with correct args, colors, radii** |
| `tests/api/thread.route.test.ts` | API route integration tests **(including all error status code mappings)** |
| `tests/api/health.route.test.ts` | **Health endpoint tests** |
| `tests/e2e/happy-path.spec.ts` | **E2E: paste URL, graph renders, click node, use filter, keyboard nav (consolidated)** |

### Config Files

| File | Purpose |
|------|---------|
| `vercel.json` | Build settings, function config (10s max duration), security headers |
| `.vercelignore` | Exclude docs, test fixtures, planning files from deployment |
| `.github/workflows/ci.yml` | CI pipeline: lint, type-check, unit tests, integration tests, build, E2E tests on `develop` merges |
| `.env.example` | Template with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` placeholder |
| `next.config.ts` | Security headers (CSP including `worker-src 'self'`, HSTS, X-Frame-Options, etc.) |
| `tailwind.config.ts` | Extended theme mapping CSS variables to Tailwind utilities |
| `vitest.config.ts` | Vitest configuration |
| `playwright.config.ts` | Playwright configuration (base URL, timeouts, browsers) |

---

## 7. TEST PLAN SUMMARY

### Test Counts by Level (Revised)

| Level | Framework | Test Count | Run Context |
|-------|-----------|------------|-------------|
| Unit | Vitest | ~45 tests | CI on every push |
| Integration | Vitest | ~10 tests | CI on every push |
| E2E | Playwright | ~5 tests | CI on `develop` merges; manual during dev |
| Manual | Human | ~8 checks | Pre-release |
| **Required Total** | | **~68 tests** | |

| Level | Framework | Test Count | Run Context |
|-------|-----------|------------|-------------|
| Stretch E2E | Playwright | ~10 tests | If time permits |
| Stretch Unit | Vitest | ~10 tests | If time permits |
| **Stretch Total** | | **~88 tests** | |

### Test Strategy by Layer

**Unit tests (~45, required):** All `lib/` modules including:
- `sentiment.test.ts` — scoring, preprocessing (URL stripping, quote stripping)
- `cache.test.ts` — get/set, TTL, key normalization
- `rateLimiter.test.ts` — allow/block, sliding window behavior
- `sanitize.test.ts` — XSS vectors, formatting preservation
- `redditParser.test.ts` — node/edge counts, stub handling, 500-cap, **permalink normalization**
- `redditFetch.test.ts` — **`X-Ratelimit-Remaining` header parsing, 503 on exhaustion**
- `graphUtils.test.ts` — **hit-testing correctness, coordinate transforms, node radius (including `score_hidden`)**
- `threadGraph.render.test.ts` — **Canvas draw functions via mocked `CanvasRenderingContext2D`**
- `errors.test.ts` — error class → HTTP status mapping

**Integration tests (~10, required):** API route:
- `thread.route.test.ts` — full request flow with mocked Redis and Reddit, **all error status codes**
- `health.route.test.ts` — Redis ping, degraded flag behavior

**E2E tests (~5, required):** Happy-path only:
- Paste valid URL → graph renders
- Click node → detail panel opens with correct data
- Depth slider filters nodes
- Keyboard navigation (Tab/Enter/Escape)
- Invalid URL → error message displayed

**Canvas correctness:** Tested at the unit level, not E2E. Mocked `CanvasRenderingContext2D` verifies `drawNode` and `drawEdge` are called with correct coordinates, colors, and radii.

**Visual regression:** Deferred to Phase 2.

### Coverage Targets

| Scope | Target |
|-------|--------|
| `lib/` modules (unit) | >= 90% line coverage |
| API route (integration) | >= 85% branch coverage |
| Overall project | >= 75% line coverage |

### CI Pipeline Stages

| Stage | Trigger | Duration |
|-------|---------|----------|
| Lint (`npm run lint`) | Every push | ~30s |
| Type-check (`npx tsc --noEmit`) | Every push | ~15s |
| Unit tests (`vitest run tests/lib/`) | Every push | ~15s |
| Integration tests (`vitest run tests/api/`) | Every push | ~30s |
| Build (`npm run build`) | Every push | ~60s |
| E2E tests (`playwright test`) | Merges to `develop`, PRs to `develop` | ~2 min |

### Acceptance Criteria Mapped to Tests

| AC# | Criterion | Key Tests | Level |
|-----|-----------|-----------|-------|
| AC1 | URL paste → graph within 5s cached / 10s uncached | `test_happy_path_graphRenders` | E2E |
| AC2 | Nodes sized by score, colored by sentiment (color-blind-safe) | `test_nodeRadius_*`, `test_drawNode_*`, `test_classify_*` | Unit |
| AC3 | Pan/zoom smooth | Manual verification | Manual |
| AC4 | Click node → detail panel with sanitized text | `test_happy_path_clickNodeOpensDetail`, `test_sanitize_*` | E2E + Unit |
| AC5 | Depth slider and score filter update graph | `test_happy_path_depthSliderFilters` | E2E |
| AC6 | >500 comments → capped view with stubs | `test_parseThread_largeThread_capsAt500Nodes`, `test_parseThread_moreStubs_*` | Unit |
| AC7 | Same thread within 15 min from cache | `test_apiThread_cachedThread_returnsCachedData`, `test_set_storesWithTTL_*` | Integration + Unit |
| AC8 | >10 req/min from one IP → 429 | `test_checkLimit_eleventhRequest_blocks`, `test_apiThread_rateLimitExceeded_returns429` | Unit + Integration |
| AC9 | Non-Reddit URLs → 400 | `test_isValidUrl_nonRedditUrl_returnsFalse`, `test_apiThread_invalidUrl_returns400` | Unit + Integration |
| AC10 | Control panel + detail panel keyboard-navigable | `test_happy_path_keyboardNavigation` | E2E |

---

## 8. REDDIT-SPECIFIC GOTCHAS

The following findings from the Reddit domain expert will cause bugs if ignored. Every engineer should read this section before writing code.

### 1. `replies` can be an empty string, not null

Reddit sets `replies` to `""` (empty string) instead of `null` or `undefined` when a comment has no replies. Accessing `.data.children` on an empty string throws a `TypeError`. **Always check `typeof replies === 'object'` before traversing.**

### 2. `parent_id` uses type-prefixed format (`t1_`, `t3_`)

Comment `parent_id` values look like `t1_abc123` or `t3_xyz789`. Node IDs are bare (`abc123`). If you build edges using `parent_id` without stripping the prefix, source/target IDs will not match node IDs and your graph will have zero edges. **Pick one convention (bare IDs) and strip prefixes consistently.**

### 3. `body_html` is double HTML-encoded

Reddit's JSON response HTML-entity-encodes the already-HTML `body_html` field. So `<p>` becomes `&lt;p&gt;` in the JSON string value. The JSON parser decodes one level, but Reddit itself encoded it once more, so you get literal `&lt;p&gt;` text. **Decode HTML entities before passing to DOMPurify.**

### 4. `"more"` objects come in two flavors

- **Normal "more":** Has `children: ["id1", "id2", ...]` and `count: N` (N > 0). Represents breadth truncation.
- **"Continue this thread":** Has `id: "_"`, `children: []`, `count: 0`. Represents depth truncation.

Both become stub nodes, but they need different labels. A "more" with `count: 0` should say "Continue this thread" not "Load more (0 comments)."

### 5. `edited` is a boolean OR a Unix timestamp

The `edited` field is `false` when unedited, but a **float Unix timestamp** when edited. Code like `if (edited) { ... }` works, but `if (typeof edited === 'boolean')` will miss edited comments. **Check `if (edited !== false)` to detect edits.**

### 6. `num_comments` will never match your parsed count

Reddit's `num_comments` counts ALL comments including deleted ones and those hidden behind "more" objects. Your parser will always return fewer nodes than `num_comments`. **Display both: "Showing 200 of 847 comments."** Do not treat the mismatch as a bug.

### 7. Deleted parent comments create orphan references

When a deleted comment's children survive but the deleted comment itself is omitted from the JSON, child comments will have a `parent_id` referencing a node that does not exist. **Your tree-builder must handle missing parents** by reparenting to the root node or creating a synthetic placeholder.

### 8. `score_hidden: true` means score is always 1

Many subreddits hide scores for the first 1-24 hours. When `score_hidden` is true, the API returns `score: 1` regardless of actual score. **Display "score hidden" in the detail panel instead of "1." Node sizing uses median node radius (neutral/default size) rather than computing from the fake score value.**

### 9. Reddit's actual rate limit is ~100 requests per 600-second window

The sustained throughput is ~6 req/min. **Read `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` response headers. Log a warning when remaining drops below 5. Return 503 with `Retry-After` when remaining reaches 0.** Do not rely on a single "60 req/min" figure -- the actual behavior is a 600-second sliding window.

### 10. Comment permalink deep-links scope the JSON response

If a user pastes a URL like `.../comments/abc123/title/def456/`, the `.json` response returns only the subtree rooted at comment `def456`, not the full thread. **Strip the comment ID segment from the URL during normalization** to always fetch the complete thread. The comment ID is the path segment after the slug. **A test fixture (`comment-permalink.json`) and unit test (`test_normalizeUrl_commentPermalink_stripsCommentId`) verify this behavior.**

---

## 9. RISK REGISTER

| Risk | Severity | Mitigation | Owner | Status |
|------|----------|------------|-------|--------|
| Reddit `.json` endpoint disappears or is restricted | **Critical** | `DataSource` interface allows swap within 1 day. Cache preserves recently-fetched data. User-Agent header identifies the app respectfully. | Backend | Open |
| Vercel 10-second function timeout exceeded on uncached large threads | **High** | **Day 1 benchmark determines processing strategy. Fallback options: client-side sanitization, `sanitize-html`, or split-request architecture.** | Backend + DevOps | **Mitigated by RC#1** |
| D3 chokes on 500 nodes (frame drops, jank) | **High** | Web Worker offloads simulation. Canvas rendering (not SVG). Float32Array transferable messages. 300-tick simulation cap. **Main-thread fallback if Worker unstable.** | Frontend | **Mitigated by RC#2** |
| Open relay abuse (proxying arbitrary URLs) | **High** | URL allowlisting regex. Per-IP rate limiting. No CORS headers (same-origin only). | Backend + DevOps | Open |
| Rate limits degrade UX (every request hits Reddit) | **High** | 15-min TTL cache. Display data freshness ("fetched 3 min ago"). **Read Reddit's `X-Ratelimit-Remaining` header and return 503 when exhausted.** | Backend | **Mitigated by RC#4** |
| XSS via unsanitized comment HTML | **High** | Server-side DOMPurify sanitization during parse, before caching (or client-side per benchmark). Allowlist-only approach. | Backend | Open |
| Reddit rate limits Vercel's IP on concurrent cache misses | **High** | **`redditFetch.ts` reads `X-Ratelimit-Remaining` and backs off. Log warning at <5 remaining. 503 at 0.** | Backend | **Mitigated by RC#4** |
| Silent degradation when Redis is down | **High** | **`redis.ts` failure counter + `isDegraded()` flag. `/api/health` endpoint. `X-Degraded: cache` response header. Structured log warnings.** | Backend + DBA | **Mitigated by RC#6** |
| `isomorphic-dompurify` compatibility/performance on Vercel serverless | **High** | **Day 1 benchmark. Fallback: `sanitize-html` or client-side DOMPurify.** | Backend | **Mitigated by RC#5** |
| ThreadGraph.tsx complexity causes schedule slip | **High** | **5-day allocation (expanded from 3). Phased build with Wednesday fallback checkpoint. Main-thread simulation as escape hatch.** | Frontend | **Mitigated by RC#2** |
| Upstash 10K commands/day exhausted | **Medium** | Each request uses 3-4 commands. Practical limit ~2,500-3,300 page loads/day. Monitor via `/api/health` and Upstash dashboard. Upgrade to pay-as-you-go ($0.2/100K) if needed. | DBA + DevOps | Open |
| Upstash 256 MB storage exhausted | **Low** | 15-min TTL keeps steady-state low. At ~300-630 KB/thread, ~400-850 threads fit. Reduce TTL to 10 min if needed. | DBA | Open |
| Lighthouse performance < 80 with 500 nodes | **Medium** | Lazy-load D3 modules via `next/dynamic`. Minimize initial JS bundle (< 200 KB gzipped total). | Frontend | Open |
| Reddit response structure changes (fields renamed/removed) | **Medium** | Test fixtures captured from real responses. Parser tests run in CI. Fixture refresh if tests fail. | QA + Backend | Open |
| AFINN sentiment inaccurate on Reddit text (sarcasm, slang) | **Medium** | Accept as known limitation. Wide neutral band (-0.2 to 0.2). **Strip quote blocks, URLs, and markdown before scoring.** Display sentiment as spectrum, not classification. | Backend | **Improved by Rec#1** |
| Non-English threads produce meaningless sentiment colors | **Low** | All comments score near 0 (neutral/gray). Acceptable visual. Document the limitation. | Backend | Open |
| Scope creep beyond 4-week timeline | **Medium** | Hard time-box. **4 buffer days built into schedule. Scope cuts already applied.** Data table is a stretch goal, not required. Ship what exists at deadline. | PM | **Mitigated by RC#7** |
| Contest mode threads have randomized order and hidden scores | **Low** | Detect `contest_mode: true`. Sentiment-by-score features are meaningless but the graph structure is still valid. | Reddit + Backend | Open |
| Partial thread cached as full thread (permalink URL) | **Medium** | **Permalink URL normalization in `redditParser.ts`. Test fixture and unit test verify behavior.** | Backend | **Mitigated by Rec#3** |

---

## 10. OPEN QUESTIONS (Resolved)

The following items surfaced conflicts or ambiguities between specialist plans. All have been resolved.

### 10.1 Root post node: inside or outside the 500-cap?

**Resolution:** The root post is always included. The cap applies to comment nodes only. Maximum graph size is 501 nodes (1 post + 500 comments).

### 10.2 Cache key: by thread ID or by full normalized URL?

**Resolution:** Key by thread ID (`tc:cache:thread:<thread_id>`). The thread ID is the unique immutable identifier. The full URL is redundant.

### 10.3 Rate limit algorithm: fixed window or sliding window?

**Resolution:** Use `@upstash/ratelimit` with sliding window. The package handles all the complexity in 3 lines of setup.

### 10.4 IP hashing for rate limit keys

**Resolution:** Use `@upstash/ratelimit` as-is. The library handles key generation internally. For a portfolio project with no user accounts and no data retention, raw IP via the library is acceptable.

### 10.5 Should `lib/cache.ts` support local Redis fallback?

**Resolution:** Three modes: (1) Upstash REST if `UPSTASH_REDIS_REST_URL` is set, (2) no-op passthrough cache if no Redis env vars are set (for CI builds and offline dev), (3) no local Redis support in Phase 1.

### 10.6 Should structured logging be added in Phase 1?

**Resolution:** Yes. Minimal structured logging in the API route: `console.log(JSON.stringify({ event, threadId, duration, cacheHit, status, degraded, redditRateLimitRemaining }))`. No logging library needed.

### 10.7 `bodyHtml`: Reddit's pre-rendered HTML or our own markdown rendering?

**Resolution:** Use Reddit's `body_html` (decode HTML entities, then sanitize). Use `body` (raw markdown, post-preprocessing) for sentiment analysis.

### 10.8 Sort order in cache key?

**Resolution:** No. Strip all query parameters. Cache one version per thread (default sort).

### 10.9 Sanitization strategy: server-side or client-side?

**Resolution:** Determined by Day 1 benchmark (see Section 3, Week 1). Default is server-side `isomorphic-dompurify`. Fallbacks: `sanitize-html` (if DOMPurify too slow) or client-side DOMPurify (if all server-side options too slow).

---

## 11. DEFINITION OF DONE (PHASE 1)

Phase 1 is declared complete when ALL of the following are satisfied.

### PRD Acceptance Criteria (all 10 must pass)

- [ ] **AC1:** User pastes a valid Reddit thread URL and sees a force-directed graph render within 5 seconds (cached) or 10 seconds (uncached, <= 500 comments).
- [ ] **AC2:** Graph nodes are sized by score and colored by sentiment using the color-blind-safe blue/gray/orange palette. Nodes with `score_hidden` use neutral/default sizing.
- [ ] **AC3:** Pan/zoom works smoothly (no perceptible frame drops on reference hardware).
- [ ] **AC4:** Clicking a node opens the detail panel with sanitized comment text, author, score (or "score hidden"), depth, and permalink.
- [ ] **AC5:** Depth slider and score filter dynamically update the visible graph.
- [ ] **AC6:** Threads with >500 comments display a capped view with "load more" stub nodes.
- [ ] **AC7:** Repeated requests for the same thread within 15 minutes are served from cache.
- [ ] **AC8:** A single IP sending >10 requests/minute receives 429 responses with `Retry-After` header.
- [ ] **AC9:** Non-Reddit URLs submitted to the API route receive 400 responses.
- [ ] **AC10:** Control panel and detail panel are fully navigable via keyboard (Tab, Enter, Escape).

### Quality Gates

- [ ] All required unit tests pass (>= 90% line coverage on `lib/` modules)
- [ ] All required integration tests pass (>= 85% branch coverage on API route)
- [ ] All required E2E tests pass (5 happy-path tests)
- [ ] Lighthouse performance score >= 80 (with 500-comment thread loaded, manual audit)
- [ ] Lighthouse accessibility score >= 70 (manual audit)
- [ ] No console errors on clean page load
- [ ] CI pipeline fully green on `main` branch

### Security Verification

- [ ] Sanitization prevents XSS in comment HTML (verified by unit tests with XSS fixtures)
- [ ] URL allowlisting rejects non-Reddit domains (verified by unit + integration tests)
- [ ] Rate limiting enforces 10 req/min per IP (verified by integration test)
- [ ] Security headers present: CSP (including `worker-src 'self'`), HSTS, X-Frame-Options, X-Content-Type-Options
- [ ] No CORS headers (same-origin only)
- [ ] Zero open-relay incidents

### Infrastructure

- [ ] Deployed to production on Vercel (`main` branch)
- [ ] Stable for >= 24 hours post-deploy (no 500 errors in Vercel Runtime Logs)
- [ ] Upstash Redis operational (cache + rate limiting functional)
- [ ] `/api/health` returns healthy status on production
- [ ] Cache hit rate trending toward 70% (after sufficient usage)
- [ ] Rollback procedure documented in README.md

### Documentation

- [ ] `.env.example` documents all required environment variables
- [ ] Rollback procedure in README.md (one paragraph: revert via Vercel dashboard)
- [ ] Test fixtures documented in `tests/fixtures/README.md`
- [ ] Day 1 benchmark results documented in `build_log.md`
- [ ] ThreadGraph fallback decision documented in `build_log.md`

### Deferred to Phase 1.1 (not required for Phase 1 completion)

- [ ] Collapse/expand branch logic in ControlPanel + ThreadGraph
- [ ] Responsive/mobile-optimized layout (drawer, full-width panels)
- [ ] Lighthouse CI automation (`lighthouserc.js`)
- [ ] Data table alternative view (`components/DataTable.tsx`)
- [ ] Visual regression testing setup
- [ ] Web Worker integration (if main-thread fallback was used)

---

*This document is the single source of truth for the Phase 1 build. It supersedes `BUILD_PLAN_FULL_v1.md`. When a specialist plan conflicts with this document, this document takes precedence. When this document is silent on a detail, refer to the specialist plan for that domain. When both are silent, refer to the PRD.*
