# Thread Cartographer

An interactive web app that visualizes Reddit comment threads as explorable force-directed graphs. Paste a URL, see conversation structure.

## What It Does

- Paste any Reddit thread URL
- See an interactive force-directed graph of the comment tree
- Nodes sized by score, colored by sentiment (color-blind-safe blue/gray/orange)
- Pan, zoom, click nodes to read comments
- Filter by depth and score

## Prerequisites

- Node.js 20+
- [Upstash Redis](https://upstash.com/) account (free tier works)

## Setup

```bash
# Clone and install
git clone <repo-url>
cd thread-cartographer
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Upstash credentials

# Run locally
npm run dev          # http://localhost:3000
```

## Scripts

```bash
npm run dev          # Local dev server (port 3000)
npm run build        # Production build
npm run lint         # Lint
npm run test         # Unit/integration tests (Vitest)
npx playwright test  # E2E tests (Playwright)
```

## Architecture

See [`BUILD_PLAN_FULL_v2.md`](BUILD_PLAN_FULL_v2.md) for the full technical spec.

```
app/
  page.tsx                 — URL input + visualization container
  api/thread/route.ts      — validates URL, rate limits, delegates to DataSource
  api/health/route.ts      — Redis status + cache metrics
components/
  ThreadGraph.tsx           — D3 Canvas force graph (client component)
  NodeDetail.tsx            — slide-out comment detail panel
  ControlPanel.tsx          — depth slider, score filter, color legend
  UrlInput.tsx              — URL text field with validation + loading states
lib/
  dataSource.ts             — DataSource interface (critical abstraction)
  redditJsonDataSource.ts   — Reddit .json implementation
  cache.ts                  — Upstash Redis caching (15-min TTL)
  rateLimiter.ts            — Per-IP rate limiting (10 req/min)
  sentiment.ts              — AFINN-based sentiment scoring
  sanitize.ts               — DOMPurify HTML sanitization
workers/
  forceLayout.worker.ts     — D3 force simulation in Web Worker
```

## Key Decisions

- [PRD](docs/decisions/DECISION-001-thread-cartographer-prd.md) — Product requirements
- [AAP Verdict](docs/decisions/DECISION-002-build-plan-v1-aap-verdict.md) — Adversarial review of build plan

## Rollback

To revert a production deployment, go to the Vercel dashboard → Deployments → find the previous stable deployment → click "..." → Promote to Production.

## License

Private — not open source.
