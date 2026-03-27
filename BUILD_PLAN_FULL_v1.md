# Thread Cartographer -- Unified Build Plan v1

**Date:** 2026-03-26
**Status:** Active
**PRD:** [`docs/decisions/DECISION-001-thread-cartographer-prd.md`](docs/decisions/DECISION-001-thread-cartographer-prd.md)

---

## 1. PROJECT OVERVIEW

Thread Cartographer is an interactive web application that transforms Reddit thread URLs into force-directed graph visualizations, revealing the hidden topology of online conversations -- who replied to whom, where debate forks, where consensus forms, and where tangents live. Users paste a Reddit thread URL and receive a Canvas-rendered, D3-powered force-directed graph where nodes represent comments (sized by score, colored by AFINN sentiment using a color-blind-safe blue/gray/orange palette) and edges represent reply relationships. The application runs on Vercel (free tier), uses Upstash Redis for caching (15-minute TTL) and per-IP rate limiting (10 req/min), and caps visualization at 500 comment nodes with "load more" stubs for truncated branches. All Reddit data flows through a `DataSource` abstraction so the data source can be swapped within a day of refactoring. The force simulation runs in a Web Worker to keep the UI responsive, and all comment HTML is sanitized via DOMPurify before rendering.

**Total estimated effort across all tracks:**

| Track | Effort |
|-------|--------|
| Frontend (UI/UX) | ~17.75 days |
| Backend (API/Data) | ~5-6 days |
| DBA (Redis/Cache) | ~2-3 days |
| DevOps (Infra/CI) | ~2 days |
| QA (Testing) | ~10 days |
| **Total** | **~37-42 working days** |

Note: Many of these tracks run in parallel. A solo developer can execute the full plan in 4 weeks by interleaving work. With 2-3 contributors, the parallelism is even more effective.

**Key constraints:**

- **Reddit API:** 60 requests per 10-minute window (unauthenticated). Undocumented `.json` endpoint could be restricted at any time.
- **500-node cap:** Threads exceeding 500 comments display top-level comments + 2 levels of replies. No recursive `/api/morechildren` fetching.
- **4-week timeline:** Hard time-box. Ship what exists at deadline.
- **$0/month cost:** Vercel Hobby plan, Upstash free tier (256 MB storage, 10K commands/day).
- **Vercel function timeout:** 10 seconds max on Hobby plan, which matches the PRD's uncached render target exactly -- zero margin.

---

## 2. DEPENDENCY MAP

### Component Dependency Graph

```
Upstash Redis Provisioning (DevOps)
    |
    v
lib/redis.ts (singleton client)
    |
    +-- lib/cache.ts (DBA/Backend)
    |       |
    +-- lib/rateLimiter.ts (DBA/Backend)
    |       |
    v       v
lib/types.ts (Backend) <-- MUST BE FIRST CODE DELIVERABLE
    |
    +-- lib/errors.ts (Backend)
    +-- lib/sentiment.ts + lib/afinn.ts (Backend)
    +-- lib/sanitize.ts (Backend -- shared with Frontend)
    +-- lib/dataSource.ts (interface only)
    |
    v
lib/redditFetch.ts (Backend)
lib/redditParser.ts (Backend)
    |
    v
lib/redditJsonDataSource.ts (Backend -- depends on ALL above)
    |
    v
app/api/thread/route.ts (Backend -- depends on DataSource, cache, rateLimiter)
    |
    v
styles/theme.css (Frontend -- no deps, can start Day 1)
workers/forceLayout.worker.ts (Frontend -- depends on types.ts)
    |
    v
components/ThreadGraph.tsx (Frontend -- depends on worker, sentiment, theme)
    |
    +-- components/ControlPanel.tsx (parallel with below)
    +-- components/NodeDetail.tsx   (parallel with above)
    +-- components/UrlInput.tsx     (parallel -- needs API route for integration)
    |
    v
app/page.tsx (Frontend -- orchestrates all components)
    |
    v
Accessibility audit + performance tuning (Frontend)
E2E tests (QA -- needs full UI + API)
Lighthouse CI (QA/DevOps)
Security hardening verification (DevOps)
```

### What Must Be Built First

1. **Upstash Redis provisioned** and environment variables set (DevOps, Day 1 morning)
2. **`lib/types.ts`** -- all other code depends on `CommentNode`, `ThreadEdge`, `ThreadData` types
3. **`lib/redis.ts`** -- singleton client used by cache and rate limiter
4. **`lib/cache.ts` + `lib/rateLimiter.ts`** -- infrastructure survival layer
5. **`styles/theme.css`** -- foundational CSS variables (can start in parallel with #2-4)

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
| Frontend | Next.js project skeleton on GitHub | DevOps (Vercel link, CI) | Yes |
| Frontend | `package.json` with lint/test/build scripts | DevOps (CI pipeline) | Yes |
| Frontend | `app/layout.tsx` | DevOps (Speed Insights) | Yes |
| QA | Test fixtures in `tests/fixtures/` | Backend (parser tests) | Helpful but not blocking |

### Critical Path

```
Day 1: types.ts + redis.ts + theme.css + Upstash provisioning
    |
Day 1-3: cache.ts + rateLimiter.ts + sentiment.ts + sanitize.ts + forceLayout.worker.ts
    |
Day 3-6: redditFetch.ts + redditParser.ts + redditJsonDataSource.ts + ThreadGraph.tsx
    |
Day 6-8: api/thread/route.ts + ControlPanel + NodeDetail + UrlInput
    |
Day 8-10: page.tsx integration + CI pipeline + security headers
    |
Day 10-15: E2E tests + accessibility audit + performance tuning
    |
Day 15-20: Polish, bug fixes, Lighthouse audit, production deployment
```

---

## 3. WEEK-BY-WEEK BUILD SCHEDULE

### Week 1: Foundation + Infrastructure + Data Pipeline

**Goal:** All infrastructure operational. Reddit fetch/parse pipeline working end-to-end in isolation. Web Worker prototype rendering mock data.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | `lib/types.ts`, `lib/errors.ts`, `lib/redis.ts`, `.env.example`, `.env.local`, `styles/theme.css`, `vercel.json`, `.vercelignore` | Backend + DevOps + Frontend |
| Mon | Provision Upstash Redis, create Vercel project, link GitHub repo | DevOps |
| Tue | `lib/cache.ts`, `lib/rateLimiter.ts`, `lib/sanitize.ts` | Backend/DBA |
| Tue | `lib/sentiment.ts`, `lib/afinn.ts` | Backend |
| Tue | `workers/forceLayout.worker.ts` (skeleton + message protocol) | Frontend |
| Wed | `lib/redditFetch.ts`, `lib/redditParser.ts` | Backend |
| Wed | `tests/fixtures/reddit/*.json` (capture 4-5 real Reddit thread responses) | QA |
| Wed | `tests/mocks/redisClient.mock.ts`, `tests/mocks/fetchMock.ts` | QA |
| Thu | `lib/redditJsonDataSource.ts`, `lib/dataSource.ts` | Backend |
| Thu | `tests/lib/fixtureDataSource.ts` | Backend |
| Thu-Fri | Unit tests: `sentiment.test.ts`, `cache.test.ts`, `rateLimiter.test.ts`, `sanitize.test.ts` | QA/Backend |
| Fri | `app/api/thread/route.ts` | Backend |
| Fri | `.github/workflows/ci.yml` | DevOps |

#### What Gets Tested

- All `lib/` modules have unit tests
- Cache get/set with TTL verification
- Rate limiter: 10 requests allowed, 11th blocked
- URL validation: Reddit URLs accepted, non-Reddit rejected
- Reddit parser against fixture JSON: correct node/edge counts, stub handling, 500-cap
- Sentiment scoring: positive/negative/neutral classification
- Sanitization: XSS vectors stripped, formatting preserved
- CI pipeline green on first run

#### What Gets Deployed

- Vercel preview deployment with skeleton Next.js app
- API route functional on preview URL (testable via curl)

#### Definition of Done (Week 1)

- [ ] `curl /api/thread?url=<reddit_url>` returns valid `ThreadData` JSON
- [ ] Cache hit on repeated request within 15 minutes (verified via response `meta.cached`)
- [ ] 11th request from same IP returns 429 with `Retry-After` header
- [ ] Non-Reddit URL returns 400
- [ ] All unit tests pass in CI
- [ ] Web Worker skeleton compiles and responds to INIT message with mock positions

#### Risks/Blockers

- **Reddit API changes:** If `.json` endpoint behavior has changed since fixtures were captured, parser tests may fail. Mitigation: capture fresh fixtures on Day 1.
- **Upstash provisioning delays:** Unlikely but possible. Mitigation: code can be developed with a no-op cache fallback.
- **`isomorphic-dompurify` + Node.js compatibility:** May need `jsdom` peer dependency. Test early.

---

### Week 2: Frontend Visualization + API Integration

**Goal:** Force-directed graph renders real Reddit data. All major UI components functional. Pan/zoom working.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon-Wed | `components/ThreadGraph.tsx` (Canvas rendering + worker integration + d3-zoom) | Frontend |
| Mon | `lib/graphUtils.ts` (quadtree, coordinate transforms, hit-testing) | Frontend |
| Tue | `components/UrlInput.tsx` (validation, loading states, metadata bar) | Frontend |
| Wed | `components/ControlPanel.tsx` (depth slider, score threshold, legend) | Frontend |
| Wed | `components/NodeDetail.tsx` (slide-out panel, keyboard focus trap) | Frontend |
| Thu | `app/page.tsx` (state orchestration, component composition) | Frontend |
| Thu | `app/layout.tsx` (metadata, font loading, theme import, Speed Insights) | Frontend |
| Thu-Fri | Integration tests: `tests/api/thread.route.test.ts` | QA |
| Fri | `next.config.ts` (security headers, CSP) | DevOps |
| Fri | `redditJsonDataSource.test.ts` (parser unit tests against all fixtures) | QA |

#### What Gets Tested

- ThreadGraph renders 500 nodes without frame drops
- Pan/zoom smooth on desktop
- Node click opens detail panel with correct comment data
- Depth slider and score filter dynamically update visible nodes
- URL input validates, submits, shows loading state, displays error on failure
- Integration tests: full request flow with mocked Redis and Reddit
- Security headers present on preview deployment

#### What Gets Deployed

- Preview deployment with functional graph visualization
- Testable end-to-end: paste URL, see graph, click nodes, use filters

#### Definition of Done (Week 2)

- [ ] Paste a Reddit URL --> graph renders within 10 seconds (uncached)
- [ ] Cached request renders within 5 seconds
- [ ] Nodes sized by score, colored by sentiment (blue/gray/orange)
- [ ] Pan/zoom with mouse wheel and drag
- [ ] Click node --> detail panel shows author, score, sanitized body, permalink
- [ ] Depth slider hides nodes beyond selected depth
- [ ] Score threshold hides nodes below selected score
- [ ] Color legend visible in control panel
- [ ] All integration tests pass in CI

#### Risks/Blockers

- **ThreadGraph is the most complex component** (~3 days). If it slips, Week 3 work is delayed. Mitigation: develop against mock data, do not wait for API integration.
- **d3-zoom + Canvas + Web Worker coordination** is tricky. Mitigation: get basic rendering working first, add zoom second.
- **CSP may block Web Worker.** Mitigation: add `worker-src 'self'` to CSP and test early.

---

### Week 3: Integration, Accessibility, Polish

**Goal:** Full end-to-end flow polished. Keyboard navigation complete. Responsive behavior functional. E2E tests written.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | Keyboard navigation wiring (Tab order, Enter/Escape, arrow keys in graph) | Frontend |
| Mon | Focus trap for NodeDetail panel, ARIA labels on all controls | Frontend |
| Tue | Responsive behavior: mobile drawer for ControlPanel, full-width NodeDetail on mobile | Frontend |
| Tue | Collapse/expand branch logic in ControlPanel + ThreadGraph | Frontend |
| Wed | `tests/e2e/thread-visualization.spec.ts` | QA |
| Wed | `tests/e2e/node-detail-panel.spec.ts` | QA |
| Thu | `tests/e2e/control-panel.spec.ts` | QA |
| Thu | `tests/e2e/keyboard-navigation.spec.ts` | QA |
| Fri | `tests/e2e/performance.spec.ts` | QA |
| Fri | `playwright.config.ts`, `lighthouserc.js` | QA/DevOps |

#### What Gets Tested

- Full E2E test suite against fixture data
- Keyboard navigation: Tab through all controls, Enter opens detail, Escape closes
- ARIA labels verified via Playwright assertions
- Lighthouse performance >= 80, accessibility >= 70
- Color-blind simulation (Chrome DevTools emulation)
- Responsive layout at desktop/tablet/mobile breakpoints

#### What Gets Deployed

- Preview deployment with complete feature set
- Pre-promotion testing checklist executed against preview

#### Definition of Done (Week 3)

- [ ] All 10 acceptance criteria pass (see Section 10)
- [ ] E2E tests pass in CI
- [ ] Lighthouse performance >= 80 with 500-comment thread
- [ ] Lighthouse accessibility >= 70
- [ ] Tab/Enter/Escape keyboard navigation functional
- [ ] Detail panel focus-trapped when open
- [ ] App functional (not optimized) on mobile viewport
- [ ] No console errors on clean page load

#### Risks/Blockers

- **Canvas keyboard navigation is inherently complex.** Arrow-key node navigation is best-effort spatial mapping. Mitigation: implement a simple index-based traversal if spatial mapping proves too complex.
- **Lighthouse 80 on performance may be tight** with D3 + Web Worker JS bundle. Mitigation: lazy-load D3 modules via `next/dynamic`.
- **E2E tests for canvas are hard** (no DOM elements to query). Mitigation: use ARIA labels, data attributes, and pixel sampling as proxies.

---

### Week 4: Production Hardening + Launch

**Goal:** Production deployment. All tests green. Documentation complete. Monitoring baseline established.

#### What Gets Built

| Day | Files | Owner |
|-----|-------|-------|
| Mon | Performance optimization: lazy loading, bundle analysis, Float32Array transfers | Frontend |
| Mon | Rate limit integration test (`tests/api/rateLimit.test.ts`) | DevOps/QA |
| Tue | Manual security tests (URL injection, SSRF, XSS, rate limit bypass) | QA |
| Tue | Manual accessibility audit (VoiceOver, color-blind sim, 200% zoom) | QA |
| Wed | Bug fixes from testing | All |
| Wed | `docs/RUNBOOK.md` (rollback procedure, monitoring thresholds) | DevOps |
| Thu | Final Lighthouse audit, fix any regressions | Frontend |
| Thu | Production deployment: merge `develop` to `main` | All |
| Fri | Post-deploy verification, monitoring baseline, celebrate | All |

#### What Gets Tested

- Full manual security test matrix (7 scenarios)
- Full manual accessibility audit (4 checks)
- Pre-promotion checklist against preview deployment
- Post-deploy smoke test against production URL
- Upstash dashboard: cache hit rate, command usage, memory

#### What Gets Deployed

- **Production deployment** to `main` branch
- Production URL: `thread-cartographer.vercel.app` (or similar)

#### Definition of Done (Week 4)

- [ ] All acceptance criteria pass on production URL
- [ ] No 500 errors in Vercel Runtime Logs for 24 hours post-deploy
- [ ] Cache hit rate trending toward 70% (requires real usage)
- [ ] Rollback procedure documented and tested
- [ ] Monitoring thresholds documented
- [ ] Zero open-relay incidents (no non-Reddit domains proxied)

#### Risks/Blockers

- **Last-minute bug cascade.** Mitigation: freeze features by Wednesday. Thursday/Friday are deploy + verify only.
- **Reddit endpoint instability** during launch week. Mitigation: cache preserves recently-fetched data; error messages are clear.

---

## 4. TECHNICAL DECISIONS SUMMARY

| Decision | Choice | Rationale | Source Plan |
|----------|--------|-----------|-------------|
| **Rendering** | HTML Canvas (not SVG) | 500 nodes = ~1500 SVG DOM elements vs 1 Canvas element. Canvas wins on frame rate, memory (2-5 MB vs 15-30 MB), and zoom/pan performance. Trade-off: manual hit-testing via quadtree. | Frontend |
| **Web Worker strategy** | D3 force simulation in dedicated Worker; positions sent as `Float32Array` (transferable) for >200 nodes, plain JSON below | Keeps main thread free of long tasks. Transferable ArrayBuffers avoid structured clone overhead at scale. | Frontend |
| **Sentiment analysis** | AFINN-165 word list, server-side scoring during parse | Zero-cost, deterministic, no API calls. Scored against `body` (raw markdown), not `body_html`. Normalization: `score / (|score| + 5)` damping to prevent short-comment dominance. | Backend + Reddit |
| **Sentiment thresholds** | Positive: > 0.2, Neutral: -0.2 to 0.2, Negative: < -0.2 | Wide neutral band acknowledges AFINN limitations on Reddit text (sarcasm, slang). | Backend |
| **Redis protocol** | Upstash REST API (`@upstash/redis`) exclusively | Serverless-native: no TCP connections, no pool exhaustion, no cold-start handshake overhead. Unlimited connections on free tier. | DBA + DevOps |
| **Cache key design** | `tc:cache:thread:<thread_id>` (e.g., `tc:cache:thread:t0ynr`) | Key by thread ID, not full URL. Short, collision-free, handles all URL variations (old.reddit, www, .json suffix, query params). | DBA |
| **Cache content** | Fully parsed `ThreadData` (post-sentiment, post-sanitize) | Cache hits skip parsing, sanitizing, and scoring. ~300-630 KB per 500-comment thread. | Backend + DBA |
| **Rate limit algorithm** | `@upstash/ratelimit` with sliding window (10 req/min) | Backend plan uses `@upstash/ratelimit` sliding window. DBA plan proposed fixed window. **Resolution: use `@upstash/ratelimit` sliding window** -- it is a 3-line setup, battle-tested, and avoids the 2x boundary burst issue. | Backend (adopted) |
| **URL normalization** | Strip query params, hash, trailing slashes, `.json` suffix. Replace all Reddit hostname variants with canonical. Extract thread ID. | Ensures all URL variants for the same thread hit the same cache key. | DBA + Reddit |
| **Sanitization library** | `isomorphic-dompurify` (allowlist-based) | DOMPurify is the industry standard. `isomorphic-dompurify` bundles `jsdom` for Node.js server-side use. Allowlist approach (only permitted tags pass) is safer than blocklist. | Backend |
| **`body_html` handling** | Use Reddit's pre-rendered `body_html`, decode HTML entities, then sanitize via DOMPurify | Avoids adding a markdown parser dependency. Reddit's double-encoding must be decoded first. Use `body` (raw markdown) for sentiment analysis. | Backend + Reddit |
| **State management** | React `useState` + `useReducer` at `page.tsx` level | State graph is shallow (thread data, filter state, selected node). No external state library needed for Phase 1. | Frontend |
| **D3 imports** | Individual modules: `d3-force`, `d3-zoom`, `d3-scale`, `d3-selection` | Avoids importing full `d3` bundle (~100 KB). Individual modules total ~40 KB gzipped. | Frontend |
| **ID normalization** | Strip `t1_`/`t3_` prefix from Reddit IDs; use bare ID as canonical | `parent_id` references use prefixed format; node IDs use bare format. Must strip consistently. | Backend + Reddit |
| **Fail-open on Redis errors** | If Redis is unreachable, allow request through (skip cache, skip rate limit). Log the error. | Blocking all users because Redis is down is worse than briefly losing rate limiting/caching. | Backend + DBA |
| **API method** | `GET /api/thread?url={encoded_url}` | Thread fetching is idempotent and cacheable. GET aligns with HTTP semantics. | Backend |
| **IP extraction** | `x-forwarded-for` (Vercel-set), fallback to `x-real-ip`, then constant for localhost | Vercel provides reliable IP via these headers. | Backend + DevOps |
| **Dark mode** | Dark background as default and only mode. No light mode toggle. | PRD mandates "dark background with light nodes as default." | Frontend |
| **Short URLs (`redd.it`)** | Reject with helpful error message | Short URLs require HTTP redirect follow. Phase 1 rejects with "Please use the full Reddit thread URL." | Reddit |

---

## 5. FILE MANIFEST

### `lib/` -- Core Logic

| File | Purpose |
|------|---------|
| `lib/types.ts` | `CommentNode`, `ThreadEdge`, `ThreadData`, `FilterState`, and other shared TypeScript interfaces (per PRD Section 4.4) |
| `lib/dataSource.ts` | `DataSource` interface: `fetchThread(url)`, `isValidUrl(url)` |
| `lib/redditJsonDataSource.ts` | `RedditJsonDataSource` class implementing `DataSource`. Orchestrates cache check, fetch, parse, sentiment score, sanitize, cache write. |
| `lib/redditFetch.ts` | `fetchRedditJson(url)` -- HTTP request to Reddit `.json` endpoint with User-Agent, retries, error classification |
| `lib/redditParser.ts` | `parseRedditResponse(raw)` -- converts nested Reddit JSON tree into flat `CommentNode[]` + `ThreadEdge[]`. Handles `"more"` stubs, 500-cap, deleted comments. |
| `lib/cache.ts` | `ThreadCache` class: `get(key)`, `set(key, data)`, `normalizeThreadUrl(url)`. Upstash Redis with 15-min TTL. Hit/miss counters. |
| `lib/redis.ts` | Singleton `Redis.fromEnv()` client instance shared by cache and rate limiter |
| `lib/rateLimiter.ts` | Per-IP rate limiting via `@upstash/ratelimit` sliding window. Returns `RateLimitResult`. |
| `lib/sentiment.ts` | `scoreSentiment(text)` -- AFINN-based scoring, returns normalized [-1, 1] value |
| `lib/afinn.ts` | AFINN-165 word list as `Record<string, number>` (or re-export from `afinn-165` package) |
| `lib/sanitize.ts` | `sanitizeHtml(html)` -- DOMPurify wrapper with allowlisted tags/attributes |
| `lib/errors.ts` | Custom error classes: `ValidationError`, `RateLimitError`, `UpstreamError`, `RedditApiError` |
| `lib/graphUtils.ts` | Node sizing math, quadtree setup, coordinate transforms, hit-testing helpers |

### `app/` -- Next.js Routes and Pages

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main page: URL input + visualization container, state orchestration via `useReducer` |
| `app/layout.tsx` | Root layout: metadata, font loading, theme CSS import, `<SpeedInsights />` |
| `app/globals.css` | Tailwind base + custom global styles, theme.css import |
| `app/api/thread/route.ts` | `GET` handler: validates URL, checks rate limit, delegates to DataSource, returns `ThreadData` JSON |
| `app/api/health/route.ts` | *(Optional)* Lightweight stats endpoint: cache hit rate, uptime |

### `components/` -- React Components

| File | Purpose |
|------|---------|
| `components/ThreadGraph.tsx` | Canvas-rendered force-directed graph. Client component. Manages Web Worker, d3-zoom, hit-testing, hover/click. |
| `components/ControlPanel.tsx` | Left-side panel: depth slider, score threshold, collapse/expand, color legend |
| `components/NodeDetail.tsx` | Right-side slide-out panel: comment text (sanitized), author, score, depth, permalink. Focus-trapped. |
| `components/UrlInput.tsx` | URL text field with validation, loading states, error display, post-fetch metadata bar |
| `components/DataTable.tsx` | *(Stretch goal)* Sortable HTML table alternative to the graph view |

### `workers/` -- Web Workers

| File | Purpose |
|------|---------|
| `workers/forceLayout.worker.ts` | D3 force simulation off-main-thread. Receives INIT/FILTER/STOP messages, posts TICK/STABILIZED/ERROR. |

### `styles/` -- Theming

| File | Purpose |
|------|---------|
| `styles/theme.css` | CSS custom properties: dark mode palette, color-blind-safe sentiment colors, sizing variables |

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
| `tests/fixtures/README.md` | Documents each fixture's source URL and capture date |
| `tests/mocks/redisClient.mock.ts` | In-memory Map-based Redis mock with TTL simulation |
| `tests/mocks/fetchMock.ts` | Fetch mock returning fixture data by URL pattern |
| `tests/lib/fixtureDataSource.ts` | `FixtureDataSource` implementing `DataSource` with static JSON |
| `tests/lib/sentiment.test.ts` | Sentiment scoring unit tests |
| `tests/lib/cache.test.ts` | Cache get/set/key-normalization unit tests |
| `tests/lib/rateLimiter.test.ts` | Rate limiter unit tests |
| `tests/lib/sanitize.test.ts` | HTML sanitization unit tests |
| `tests/lib/redditJsonDataSource.test.ts` | Parser + DataSource unit tests |
| `tests/lib/dataSource.test.ts` | DataSource interface compliance tests |
| `tests/api/thread.route.test.ts` | API route integration tests |
| `tests/e2e/thread-visualization.spec.ts` | E2E: URL paste, graph render, node sizing/coloring |
| `tests/e2e/node-detail-panel.spec.ts` | E2E: node click, panel content, sanitization |
| `tests/e2e/control-panel.spec.ts` | E2E: depth slider, score filter, legend |
| `tests/e2e/keyboard-navigation.spec.ts` | E2E: Tab, Enter, Escape, arrow keys |
| `tests/e2e/performance.spec.ts` | E2E: cached/uncached render timing, pan/zoom smoothness |

### Config Files

| File | Purpose |
|------|---------|
| `vercel.json` | Build settings, function config (10s max duration), security headers |
| `.vercelignore` | Exclude docs, test fixtures, planning files from deployment |
| `.github/workflows/ci.yml` | CI pipeline: lint, type-check, unit tests, integration tests, build |
| `.env.example` | Template with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` placeholder |
| `docker-compose.yml` | *(Optional)* Local Redis for offline development |
| `next.config.ts` | Security headers (CSP, HSTS, X-Frame-Options, etc.) |
| `tailwind.config.ts` | Extended theme mapping CSS variables to Tailwind utilities |
| `vitest.config.ts` | Vitest configuration |
| `playwright.config.ts` | Playwright configuration (base URL, timeouts, browsers) |
| `lighthouserc.js` | Lighthouse CI assertions: performance >= 80, accessibility >= 70 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist (optional) |

---

## 6. TEST PLAN SUMMARY

### Test Counts by Level

| Level | Framework | Test Count | Run Context |
|-------|-----------|------------|-------------|
| Unit | Vitest | ~70 tests | CI on every push |
| Integration | Vitest | ~16 tests | CI on every push |
| E2E | Playwright | ~26 tests | CI on `develop` merges; manual during dev |
| Lighthouse | @lhci/cli | 2 assertions | CI on `develop` merges |
| Manual | Human | ~11 checks | Pre-release |
| **Total** | | **~125 tests** | |

### Coverage Targets

| Scope | Target |
|-------|--------|
| `lib/` modules (unit) | >= 90% line coverage |
| API route (integration) | >= 85% branch coverage |
| Overall project | >= 80% line coverage |

### CI Pipeline Stages

| Stage | Trigger | Duration |
|-------|---------|----------|
| Lint (`npm run lint`) | Every push | ~30s |
| Type-check (`npx tsc --noEmit`) | Every push | ~15s |
| Unit tests (`vitest run tests/lib/`) | Every push | ~15s |
| Integration tests (`vitest run tests/api/`) | Every push | ~30s |
| Build (`npm run build`) | Every push | ~60s |
| E2E tests (`playwright test`) | Merges to `develop`, PRs to `develop` | ~2 min |
| Lighthouse CI | Merges to `develop` only | ~1 min |

### Acceptance Criteria Mapped to Tests

| AC# | Criterion | Key Tests | Level |
|-----|-----------|-----------|-------|
| AC1 | URL paste --> graph within 5s cached / 10s uncached | `test_cachedThread_rendersWithin5Seconds`, `test_uncachedThread_rendersWithin10Seconds` | E2E |
| AC2 | Nodes sized by score, colored by sentiment (color-blind-safe) | `test_graphRender_nodesSizedByScore_*`, `test_graphRender_sentimentColors_*`, `test_classify_*` | E2E + Unit |
| AC3 | Pan/zoom smooth | `test_panZoom_noFrameDrops` | E2E |
| AC4 | Click node --> detail panel with sanitized text | `test_clickNode_opensDetailPanel`, `test_detailPanel_sanitizedContent_noXSS`, `test_sanitize_*` | E2E + Unit |
| AC5 | Depth slider and score filter update graph | `test_depthSlider_adjusting_filtersNodes`, `test_scoreFilter_adjusting_filtersLowScoreNodes` | E2E |
| AC6 | >500 comments --> capped view with stubs | `test_parseThread_largeThread_capsAt500Nodes`, `test_parseThread_moreStubs_createsStubNodes` | Unit + Integration |
| AC7 | Same thread within 15 min from cache | `test_apiThread_cachedThread_returnsCachedData`, `test_set_storesWithTTL_*` | Integration + Unit |
| AC8 | >10 req/min from one IP --> 429 | `test_checkLimit_eleventhRequest_blocks`, `test_apiThread_rateLimitExceeded_returns429` | Unit + Integration |
| AC9 | Non-Reddit URLs --> 400 | `test_isValidUrl_nonRedditUrl_returnsFalse`, `test_apiThread_invalidUrl_returns400WithMessage` | Unit + Integration |
| AC10 | Control panel + detail panel keyboard-navigable | `test_tabNavigation_reachesAllControls`, `test_escapeKey_closesDetailPanel`, `test_enterKey_*` | E2E |

---

## 7. REDDIT-SPECIFIC GOTCHAS

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

Many subreddits hide scores for the first 1-24 hours. When `score_hidden` is true, the API returns `score: 1` regardless of actual score. **Display "score hidden" in the detail panel instead of "1."** Node sizing should treat hidden scores as neutral (default size).

### 9. Reddit's actual rate limit is ~6 req/min sustained

The "60 req/min" figure refers to burst capacity at the start of a 10-minute window (60 requests per 600 seconds). **Sustained throughput is 6 req/min.** Read `X-Ratelimit-Remaining` response headers and back off when remaining drops below 10. Store Reddit's rate limit state in Redis for informed decision-making.

### 10. Comment permalink deep-links scope the JSON response

If a user pastes a URL like `.../comments/abc123/title/def456/`, the `.json` response returns only the subtree rooted at comment `def456`, not the full thread. **Strip the comment ID segment from the URL during normalization** to always fetch the complete thread. The comment ID is the path segment after the slug.

---

## 8. RISK REGISTER

| Risk | Severity | Mitigation | Owner |
|------|----------|------------|-------|
| Reddit `.json` endpoint disappears or is restricted | **Critical** | `DataSource` interface allows swap within 1 day. Cache preserves recently-fetched data. User-Agent header identifies the app respectfully. | Backend |
| Vercel 10-second function timeout exceeded on uncached large threads | **High** | Fire-and-forget cache write (async, don't await). Aggressive parsing optimization. Consider responding with partial data if timeout is imminent. | Backend + DevOps |
| D3 chokes on 500 nodes (frame drops, jank) | **High** | Web Worker offloads simulation. Canvas rendering (not SVG). Float32Array transferable messages. 300-tick simulation cap. | Frontend |
| Open relay abuse (proxying arbitrary URLs) | **High** | URL allowlisting regex. Per-IP rate limiting. No CORS headers (same-origin only). | Backend + DevOps |
| Rate limits degrade UX (every request hits Reddit) | **High** | 15-min TTL cache. Display data freshness ("fetched 3 min ago"). Read Reddit's `X-Ratelimit-Remaining` header and queue/delay if low. | Backend |
| XSS via unsanitized comment HTML | **High** | Server-side DOMPurify sanitization during parse, before caching. Allowlist-only approach. | Backend |
| Upstash 10K commands/day exhausted | **Medium** | Each request uses 2-3 commands. Practical limit ~3,300 page loads/day. Monitor via dashboard. Upgrade to pay-as-you-go ($0.2/100K) if needed. | DBA + DevOps |
| Upstash 256 MB storage exhausted | **Low** | 15-min TTL keeps steady-state low. At ~300 KB/thread, ~850 threads fit. Reduce TTL to 10 min if needed. | DBA |
| Lighthouse performance < 80 with 500 nodes | **Medium** | Lazy-load D3 modules via `next/dynamic`. Minimize initial JS bundle (< 200 KB gzipped total). Performance measurement instrumentation. | Frontend |
| `isomorphic-dompurify` compatibility issues with Node.js | **Medium** | Test early (Day 2). Fallback: `sanitize-html` package (less robust but no `jsdom` dependency). | Backend |
| Reddit response structure changes (fields renamed/removed) | **Medium** | Test fixtures captured from real responses. Parser tests run in CI. Fixture refresh if tests fail. | QA + Backend |
| AFINN sentiment inaccurate on Reddit text (sarcasm, slang) | **Medium** | Accept as known limitation. Wide neutral band (-0.2 to 0.2). Strip quote blocks and URLs before scoring. Display sentiment as spectrum, not classification. | Backend |
| Non-English threads produce meaningless sentiment colors | **Low** | All comments score near 0 (neutral/gray). Acceptable visual. Document the limitation. | Backend |
| Scope creep beyond 4-week timeline | **Medium** | Hard time-box. Data table is a stretch goal, not required. Ship what exists at deadline. | PM |
| Contest mode threads have randomized order and hidden scores | **Low** | Detect `contest_mode: true`. Sentiment-by-score features are meaningless but the graph structure is still valid. | Reddit + Backend |

---

## 9. OPEN QUESTIONS

The following items surfaced conflicts or ambiguities between specialist plans that need resolution before coding begins.

### 9.1 Root post node: inside or outside the 500-cap?

**Backend plan** says the root post node is always included and the 500 cap applies only to comment nodes (meaning 501 total nodes possible). **Frontend plan** and **PRD** say "500-comment cap" without specifying.

**Resolution:** The root post is always included. The cap applies to comment nodes only. Maximum graph size is 501 nodes (1 post + 500 comments). This is the simpler interpretation and avoids edge cases where the post itself might be excluded.

### 9.2 Cache key: by thread ID or by full normalized URL?

**DBA plan** recommends keying by thread ID only (`tc:cache:thread:t0ynr`). **Backend plan** uses the full normalized URL as the key. The DBA approach is simpler and shorter.

**Resolution:** Key by thread ID (`tc:cache:thread:<thread_id>`). The DBA plan is correct -- the thread ID is the unique immutable identifier. The full URL is redundant.

### 9.3 Rate limit algorithm: fixed window or sliding window?

**DBA plan** recommends fixed window (simpler, fewer Redis commands). **Backend plan** recommends sliding window via `@upstash/ratelimit` (smoother, no boundary burst).

**Resolution:** Use `@upstash/ratelimit` with sliding window. The package handles all the complexity in 3 lines of setup. The marginal command cost is negligible at our scale.

### 9.4 IP hashing for rate limit keys

**DBA plan** proposes SHA-256 hashing of IP addresses to avoid storing PII. **Backend plan** does not mention IP hashing (uses raw IP implicitly via `@upstash/ratelimit`).

**Resolution:** Use `@upstash/ratelimit` as-is. The library handles key generation internally with its `prefix` option. If PII concerns arise, they can be addressed in a follow-up. For a portfolio project with no user accounts and no data retention, this is acceptable.

### 9.5 Should `lib/cache.ts` support local Redis fallback?

**DevOps plan** recommends Option B (Upstash everywhere) but suggests the cache module should support a local Redis fallback via `REDIS_URL` env var for offline development.

**Resolution:** Implement three modes: (1) Upstash REST if `UPSTASH_REDIS_REST_URL` is set, (2) no-op passthrough cache if no Redis env vars are set (for CI builds and offline dev), (3) no local Redis support in Phase 1 (Docker Compose is optional but `lib/cache.ts` does not need `ioredis`). This keeps the code simpler.

### 9.6 Should structured logging be added in Phase 1?

**Backend plan** mentions structured logging as an open question. **DevOps plan** recommends JSON-structured `console.log` in API routes.

**Resolution:** Yes, add minimal structured logging in the API route: `console.log(JSON.stringify({ event, threadId, duration, cacheHit, status }))`. This costs nothing and makes Vercel Runtime Logs searchable. No logging library needed.

### 9.7 `bodyHtml`: Reddit's pre-rendered HTML or our own markdown rendering?

**Backend plan** raises this as an open question.

**Resolution:** Use Reddit's `body_html` (decode HTML entities, then sanitize). This avoids adding a markdown parser dependency and ensures fidelity to Reddit's rendering. Use `body` (raw markdown) for sentiment analysis.

### 9.8 Sort order in cache key?

**Backend plan** asks whether `?sort=top` should produce a different cache key.

**Resolution:** No. Strip all query parameters. Cache one version per thread (default sort). Supporting sort-specific caching adds complexity with minimal benefit for Phase 1.

---

## 10. DEFINITION OF DONE (PHASE 1)

Phase 1 is declared complete when ALL of the following are satisfied.

### PRD Acceptance Criteria (all 10 must pass)

- [ ] **AC1:** User pastes a valid Reddit thread URL and sees a force-directed graph render within 5 seconds (cached) or 10 seconds (uncached, <= 500 comments).
- [ ] **AC2:** Graph nodes are sized by score and colored by sentiment using the color-blind-safe blue/gray/orange palette.
- [ ] **AC3:** Pan/zoom works smoothly (no perceptible frame drops on reference hardware).
- [ ] **AC4:** Clicking a node opens the detail panel with sanitized comment text, author, score, depth, and permalink.
- [ ] **AC5:** Depth slider and score filter dynamically update the visible graph.
- [ ] **AC6:** Threads with >500 comments display a capped view with "load more" stub nodes.
- [ ] **AC7:** Repeated requests for the same thread within 15 minutes are served from cache.
- [ ] **AC8:** A single IP sending >10 requests/minute receives 429 responses with `Retry-After` header.
- [ ] **AC9:** Non-Reddit URLs submitted to the API route receive 400 responses.
- [ ] **AC10:** Control panel and detail panel are fully navigable via keyboard (Tab, Enter, Escape).

### Quality Gates

- [ ] All unit tests pass (>= 90% line coverage on `lib/` modules)
- [ ] All integration tests pass (>= 85% branch coverage on API route)
- [ ] All E2E tests pass
- [ ] Lighthouse performance score >= 80 (with 500-comment thread loaded)
- [ ] Lighthouse accessibility score >= 70
- [ ] No console errors on clean page load
- [ ] CI pipeline fully green on `main` branch

### Security Verification

- [ ] DOMPurify sanitization prevents XSS in comment HTML (verified by unit tests with XSS fixtures)
- [ ] URL allowlisting rejects non-Reddit domains (verified by unit + integration tests)
- [ ] Rate limiting enforces 10 req/min per IP (verified by integration test)
- [ ] Security headers present: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- [ ] No CORS headers (same-origin only)
- [ ] Zero open-relay incidents

### Infrastructure

- [ ] Deployed to production on Vercel (`main` branch)
- [ ] Stable for >= 24 hours post-deploy (no 500 errors in Vercel Runtime Logs)
- [ ] Upstash Redis operational (cache + rate limiting functional)
- [ ] Cache hit rate trending toward 70% (after sufficient usage)
- [ ] Rollback procedure documented and tested
- [ ] Monitoring thresholds documented (Upstash dashboard, Vercel dashboard)

### Documentation

- [ ] `.env.example` documents all required environment variables
- [ ] `docs/RUNBOOK.md` documents rollback procedure and monitoring thresholds
- [ ] Test fixtures documented in `tests/fixtures/README.md`

### Stretch Goals (not required for Phase 1 completion)

- [ ] Data table alternative view (`components/DataTable.tsx`)
- [ ] `/api/health` stats endpoint
- [ ] Visual regression testing setup

---

*This document is the single source of truth for the Phase 1 build. When a specialist plan conflicts with this document, this document takes precedence. When this document is silent on a detail, refer to the specialist plan for that domain. When both are silent, refer to the PRD.*
