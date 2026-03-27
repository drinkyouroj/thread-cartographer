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
