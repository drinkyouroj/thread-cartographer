# DECISION: Build Plan v1 AAP Verdict

**Date:** 2026-03-27
**Status:** Accepted with Required Changes

---

## AAP: Thread Cartographer v1 Build Plan Review

### JUDGE

**Verdict:** The build plan is **approved with required changes**. The plan is well-structured, the dependency ordering is correct, and the technical decisions are sound. However, the ADVERSARY has identified several risks that are real and unmitigated, and the timeline assumes zero friction in a way that will cause schedule collapse if not addressed. The 8 required changes below must be incorporated before implementation begins.

---

## Rulings on ADVERSARY's 10 Objections

### Objection 1: Vercel 10s timeout is a showstopper — SUSTAINED

The ADVERSARY is right and the ARCHITECT agrees. The build plan acknowledges "zero margin" (line 32) but then proceeds as if this is acceptable. It is not. Cold start + Reddit fetch + DOMPurify sanitization of 500 comments + cache write is a realistic >10s path. The risk register entry (Section 8) says "fire-and-forget cache write" and "consider responding with partial data if timeout is imminent" but neither is specified.

The ADVERSARY's demand for a Day 1 latency benchmark on Vercel Hobby is correct. You cannot plan around a constraint you have not measured.

**Required:** See Required Change #1 below.

### Objection 2: ThreadGraph.tsx is 3x underestimated — PARTIALLY SUSTAINED

The ADVERSARY claims 8-10 days; the plan allocates 3 (Mon-Wed of Week 2). The truth is between these extremes, but closer to the ADVERSARY's position than the plan's. Canvas rendering + d3-zoom coordinate transforms + quadtree hit-testing + Worker message protocol + React lifecycle management is genuinely hard. The ARCHITECT also flags that `lib/graphUtils.ts` is mentioned but never specified, which is where the hardest code lives (hit-testing, coordinate transforms).

However, the ADVERSARY's 8-10 day estimate assumes a developer unfamiliar with d3-force + Canvas. The plan's risk section already identifies ThreadGraph as the single biggest risk. The real issue is not that 3 days is impossible, but that there is no fallback if it slips.

**Required:** See Required Change #2 below. The ADVERSARY's demand for a main-thread simulation fallback is correct.

### Objection 3: 125 tests is fantasy planning — SUSTAINED

The ADVERSARY is correct. 125 tests in 10 QA days, with Canvas E2E tests that cannot query DOM elements, is aspirational to the point of being a scheduling liability. The plan will produce either (a) fewer tests than promised, causing the Definition of Done to fail, or (b) the developer will spend Week 4 writing tests instead of hardening.

The ADVERSARY's proposal to cut to ~60 tests and move Canvas correctness to unit tests with mocked CanvasRenderingContext2D is pragmatic and correct.

**Required:** See Required Change #3 below.

### Objection 4: Reddit rate limit math contradicts itself — PARTIALLY SUSTAINED

The ADVERSARY correctly identifies that Gotcha #9 says "sustained throughput is 6 req/min" while the constraints section says "60 req/min." The build plan does say to read `X-Ratelimit-Remaining` headers (Gotcha #9, Risk Register), but there is no server-side outbound rate tracker specified in any file.

However, the ADVERSARY's scenario of "10 concurrent users could get the Vercel IP blocked" overstates the risk for a portfolio project that will realistically have 0-3 concurrent users. The cache layer (15-min TTL) also means most requests never hit Reddit.

That said, the ADVERSARY is right that there should be *some* outbound rate awareness. Reading the response headers and logging a warning is the minimum viable protection.

**Required:** See Required Change #4 below. A full Redis-backed outbound rate tracker is not required for Phase 1, but reading and acting on `X-Ratelimit-Remaining` headers is.

### Objection 5: isomorphic-dompurify + jsdom on serverless is a time bomb — SUSTAINED

The ADVERSARY's concern is well-founded. `isomorphic-dompurify` pulls in `jsdom` (~2 MB), which has measurable cold start impact on serverless. The build plan's risk register mentions this (line 579) but only says "test early, fallback to sanitize-html." The ARCHITECT also flags that `sentiment.ts` should strip URLs/markdown before scoring, and the ADVERSARY's point about 500 virtual DOM constructions per request compounds the concern.

The ADVERSARY's demand for a Day 1 benchmark is correct. This is the kind of dependency that can silently eat 3-4 seconds of the 10-second budget.

**Required:** See Required Change #5 below.

### Objection 6: Fail-open on Redis = silent degradation — PARTIALLY SUSTAINED

The ADVERSARY is right that fail-open without any alerting or circuit breaker means a dead Redis could cause a cascading failure (every request hammers Reddit, Reddit blocks the IP, all users get errors). The plan currently has no mechanism to detect or signal this state.

However, the ADVERSARY's demand for a full circuit breaker is overkill for Phase 1. The `/api/health` endpoint is already listed as a stretch goal. What is needed is simpler: structured logging of Redis failures (the plan already specifies structured logging in Section 9.6) and a counter/flag that detects sustained Redis failures and returns a degraded-service response rather than silently pounding Reddit.

**Required:** See Required Change #6 below. Promote `/api/health` from stretch goal to required, and add basic Redis failure detection.

### Objection 7: 37-42 days in 20 working days assumes zero friction — SUSTAINED

The ADVERSARY's math is correct. The plan acknowledges the effort totals 37-42 days and says "a solo developer can execute the full plan in 4 weeks by interleaving work." This requires near-perfect parallelism and zero learning curve, environment issues, or debugging time. Real effective capacity for a solo developer on a new stack (D3 + Canvas + Web Workers + Upstash) is 12-16 productive days out of 20.

The ARCHITECT's recommendation to accept a lower E2E test count (which I have sustained in Objection 3) recovers some time. But the plan needs explicit scope cuts to create buffer.

**Required:** See Required Change #7 below.

### Objection 8: No error UI specification — SUSTAINED

Both the ADVERSARY and the ARCHITECT flag this. The build plan specifies `lib/errors.ts` with custom error classes but never maps them to HTTP statuses or user-facing UI states. There is no specification for what the user sees when: Reddit returns 403/451/5xx, the thread is empty, the Worker crashes, the request times out, or nodes have NaN positions.

**Required:** See Required Change #8 below.

### Objection 9: Upstash free tier math is optimistic by 2x — OVERRULED

The ADVERSARY claims sliding window costs 4-5 commands per request, making the practical limit ~2,000 loads/day. The build plan estimates 2-3 commands (line 576). In practice, `@upstash/ratelimit` sliding window uses 2 commands per check, and a cache hit adds 1 command (GET), while a cache miss adds 2 (GET + SET). So the range is 3-4 commands per request, putting the practical limit at ~2,500-3,300 loads/day.

For a portfolio project, even the ADVERSARY's lower estimate of 2,000 loads/day is more than sufficient. If the project somehow gets enough traffic to exhaust the free tier, that is a success problem solved by a $0.20/100K upgrade. This is not a blocking concern.

### Objection 10: Comment permalink normalization has no implementation or test — SUSTAINED

Gotcha #10 correctly identifies that permalink URLs (`.../comments/abc123/title/def456/`) return a subtree, not the full thread. The build plan says to strip the comment ID during normalization, but no test covers this. This is a data corruption bug waiting to happen: a partial thread cached as the full thread.

**Required:** This is a test gap, not a design gap. Add a unit test for permalink normalization to the existing test plan. See Required Change #3 (revised test plan should include this case).

---

## Incorporation of ARCHITECT's 7 Concerns

1. **Vercel 10s timeout** — Covered by Objection 1. Sustained.
2. **`lib/graphUtils.ts` unspecified** — Covered by Objection 2. The file is in the manifest but has no spec. Required Change #2 addresses this.
3. **Web Worker bundling with Next.js** — The ADVERSARY did not raise this, but the ARCHITECT is right. Next.js does not natively bundle Web Workers; you need `worker-loader` or a manual approach with `new Worker(new URL(...))`. This must be resolved before ThreadGraph development. Added to Required Change #2.
4. **`lib/errors.ts` HTTP status mapping** — Covered by Objection 8. Sustained.
5. **No loading/error UI states for UrlInput or graph area** — Covered by Objection 8. Sustained.
6. **`sentiment.ts` should strip URLs/markdown before scoring** — The risk register mentions this (line 581: "Strip quote blocks and URLs before scoring") but the `sentiment.ts` specification does not. This is a minor but real gap. Added to Recommended Changes.
7. **Test fixture capture timing** — The ARCHITECT recommends moving fixture capture earlier than Wednesday. The ADVERSARY supports this indirectly (Objection 3). Reasonable. Added to Recommended Changes.

---

## Required Changes (Must Be Incorporated Before Implementation)

### Required Change #1: Vercel Timeout Strategy

Add to the Week 1 schedule (Day 1 or Day 2):

- Deploy a minimal Vercel function that: (a) fetches a known Reddit `.json` URL, (b) runs DOMPurify sanitization on 100 comments, (c) writes to Upstash Redis. Measure total cold-start and warm-start latency.
- If warm-start latency exceeds 7 seconds, implement one of these fallbacks (decide which before proceeding): (a) move sanitization client-side and cache raw parsed data, (b) stream a partial response and continue processing, (c) split fetch and processing into two requests (fetch returns a job ID, client polls for result).
- Document the benchmark result and chosen strategy in the build log.

### Required Change #2: ThreadGraph Risk Mitigation

- Allocate 5 days for ThreadGraph.tsx (Mon-Fri of Week 2), not 3. Move ControlPanel and NodeDetail development to overlap with Week 1 Day 5 and Week 2 Day 1 (they depend on types.ts and sanitize.ts, both available by then, and can be developed against mock data).
- Write a specification for `lib/graphUtils.ts` covering: quadtree construction, point-in-node hit testing, screen-to-graph coordinate transforms (for d3-zoom), and node radius calculation from score. This spec goes in the build plan or a separate DECISION doc.
- Add a fallback plan: if Web Worker + Canvas integration is not stable by end of Week 2 Wednesday, fall back to main-thread simulation with `requestAnimationFrame` throttling for the remaining schedule. The Worker can be re-added in Week 4 if time permits.
- Document the Web Worker bundling approach for Next.js. The recommended approach is `new Worker(new URL('./worker.ts', import.meta.url))` which works with webpack 5 (Next.js default bundler). Verify this works in a Vercel deployment during the Week 1 benchmark (Required Change #1).

### Required Change #3: Revised Test Plan

Replace the 125-test target with a tiered plan:

- **Required (ship-blocking):** ~60 tests total. ~45 unit tests (all `lib/` modules, including permalink normalization from Gotcha #10), ~10 integration tests (API route), ~5 E2E tests (happy path only: paste URL, see graph, click node, use filter, keyboard nav).
- **Stretch (if time permits):** Additional E2E tests for error states, edge cases, and performance assertions.
- **Canvas correctness:** Unit tests with mocked `CanvasRenderingContext2D`, not E2E pixel inspection. Verify that `drawNode` is called with correct coordinates and colors. Verify hit-testing returns the correct node for given coordinates.
- **Visual regression:** Defer to Phase 2. It is not worth the setup cost in a 4-week timeline.

### Required Change #4: Outbound Reddit Rate Awareness

Add to `lib/redditFetch.ts`:

- Read `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` from Reddit response headers.
- Log these values in the structured log (Section 9.6).
- If `X-Ratelimit-Remaining` drops below 5, log a warning. If it drops to 0, return a 503 to the client with a `Retry-After` header derived from `X-Ratelimit-Reset`, rather than sending another request to Reddit.
- A full Redis-backed outbound rate tracker is NOT required for Phase 1.

### Required Change #5: DOMPurify Serverless Benchmark

Add to the Week 1 schedule (Day 1 or Day 2, can be combined with Required Change #1):

- Benchmark `isomorphic-dompurify` sanitizing 500 comment strings on Vercel (cold start and warm). Measure both time and memory.
- If sanitization of 500 comments exceeds 2 seconds, switch to one of: (a) `sanitize-html` (lighter, no jsdom), (b) client-side sanitization (DOMPurify runs in the browser, cache stores unsanitized HTML with a flag), (c) sanitize only the visible comments on-demand in the detail panel.
- Document the benchmark result and decision.

### Required Change #6: Redis Failure Detection

- Promote `/api/health` from stretch goal to required. It should report: Redis reachability (ping), cache hit/miss counts since deploy, and current rate limit window usage.
- Add a simple failure counter to `lib/redis.ts` or `lib/cache.ts`: if 3 consecutive Redis operations fail, set an in-memory flag. When the flag is set, the API route should return a `X-Degraded: cache` response header and log a structured warning on every request. This is not a circuit breaker; it is a signal.
- The flag resets on the next successful Redis operation.

### Required Change #7: Explicit Scope Cuts for Buffer

Create 4 buffer days by making the following cuts:

- **Responsive/mobile layout (Week 3 Tuesday):** Remove from Phase 1 scope. The PRD lists "mobile-optimized layout" as a non-goal. "Functional on mobile" means the app does not crash on a mobile viewport; it does not mean responsive drawer behavior for ControlPanel. Save 1 day.
- **Collapse/expand branch logic (Week 3 Tuesday):** Defer to Phase 1.1 or Week 4 if time permits. The depth slider and score filter already provide branch filtering. Save 0.5 days.
- **Lighthouse CI automation (Week 3 Friday):** Run Lighthouse manually. Do not spend time configuring `lighthouserc.js` and CI integration. Save 0.5 days.
- **Visual regression / performance E2E (Week 3 Friday):** Covered by Required Change #3. Save 1 day.
- **Docker Compose for local Redis (Week 1):** Already marked optional. Confirm it is cut. Save 0.5 days.
- **`docs/RUNBOOK.md` (Week 4 Wednesday):** Replace with a section in README.md covering rollback (one paragraph: "revert the Vercel deployment to the previous production deployment via the Vercel dashboard"). Save 0.5 days.

These cuts free ~4 days of buffer distributed across Weeks 2-4 without removing any of the 10 acceptance criteria.

### Required Change #8: Error State Specification

Add a section to the build plan (or a subsection of Section 5, File Manifest) specifying:

| Error Condition | HTTP Status | User-Facing UI |
|---|---|---|
| Invalid/non-Reddit URL | 400 | Inline error below URL input: "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)" |
| Rate limited | 429 | Inline error: "Too many requests. Please wait {N} seconds." with countdown. |
| Reddit returned 403/451 | 502 | Graph area shows: "This thread is not accessible. It may be private, quarantined, or geo-restricted." |
| Reddit returned 5xx | 502 | Graph area shows: "Reddit is temporarily unavailable. Try again in a few minutes." |
| Request timeout | 504 | Graph area shows: "This thread took too long to load. Try a smaller thread." |
| Empty thread (0 comments) | 200 | Graph area shows single root node with message: "This thread has no comments yet." |
| Worker crash | N/A (client) | Graph area shows: "Visualization failed to load. Refresh to try again." Log error to console. |
| Redis unavailable | 200 (degraded) | No user-visible change. `X-Degraded: cache` header. Structured log warning. |

Map `lib/errors.ts` classes to HTTP statuses in `app/api/thread/route.ts`:
- `ValidationError` -> 400
- `RateLimitError` -> 429
- `UpstreamError` -> 502
- `RedditApiError` -> 502 (with differentiated messages based on Reddit's status code)
- Timeout -> 504

---

## Recommended Changes (Non-Blocking)

1. **Sentiment preprocessing:** Add to `sentiment.ts` specification: strip URLs (regex), strip Reddit quote blocks (lines starting with `>`), and strip markdown formatting (`**`, `*`, `~~`, etc.) before scoring. This is a ~30-minute addition that materially improves accuracy.

2. **Test fixture capture on Day 1:** Move fixture capture from Wednesday to Monday afternoon. The parser cannot be tested without fixtures, and fixtures are trivially captured (curl a few Reddit URLs, save the JSON). This unblocks parser development on Tuesday.

3. **Comment permalink test case:** Ensure the test fixtures include at least one permalink-scoped URL (e.g., `.../comments/abc123/title/def456/.json`) and that the URL normalization test verifies it is stripped to the thread-level URL before cache lookup.

4. **Loading states for UrlInput:** Specify three states: idle (empty input), loading (spinner + "Fetching thread..."), and loaded (metadata bar showing subreddit, comment count, "Showing X of Y comments", cache freshness). This is a UX detail that should be designed before implementation, not discovered during it.

5. **`score_hidden` handling in node sizing:** Gotcha #8 says hidden scores should be treated as neutral (default size). Add this to the `graphUtils.ts` specification: if `score_hidden` is true, use the median node radius rather than computing from score.

---

## Final Statement

The build plan demonstrates strong architectural judgment and unusually thorough domain research. The DataSource abstraction, infrastructure-first ordering, and Reddit gotchas section are genuinely excellent. The plan's weakness is schedule optimism and incomplete specification of error paths and the hardest component (ThreadGraph). The 8 required changes above address these weaknesses without fundamentally restructuring the plan. Implement these changes, then begin building.
