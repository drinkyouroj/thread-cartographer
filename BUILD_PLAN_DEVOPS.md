# Thread Cartographer -- DevOps & Infrastructure Build Plan

**Author:** DevOps/Sysadmin Lead
**Date:** 2026-03-26
**Scope:** Vercel deployment, Upstash Redis, CI/CD, environment management, security, monitoring, rollback, and local dev environment for Phase 1 MVP.
**Reference:** `docs/decisions/DECISION-001-thread-cartographer-prd.md`, `CLAUDE.md`

---

## 1. Vercel Deployment Setup

### What to do

- Create the Vercel project linked to the GitHub repository (via `vercel link` or the Vercel dashboard).
- Configure the project as a Next.js app with automatic framework detection.
- Set the build command to `npm run build` and output directory to `.next` (Vercel auto-detects these for Next.js but verify explicitly).
- Enable preview deployments for every push to any branch; production deployments only from `main`.
- Assign the `develop` branch as a preview alias (e.g., `develop.thread-cartographer.vercel.app`) for QA.

### Files to create/modify

| File | Purpose |
|------|---------|
| `vercel.json` | Build settings, function config, headers, redirects |
| `.vercelignore` | Exclude `docs/`, `IDEAS_ANALYSIS.md`, `ideas.txt`, test fixtures |

### `vercel.json` key contents

```jsonc
{
  "buildCommand": "npm run build",
  "framework": "nextjs",
  "functions": {
    "app/api/thread/route.ts": {
      "maxDuration": 10
    }
  },
  "headers": [
    // See Section 8 (Security Hardening) for full header list
  ]
}
```

The 10-second `maxDuration` aligns with the PRD's uncached render target.

### Key decisions

- **Hobby plan (free tier):** Sufficient for Phase 1. Limits: 100 GB bandwidth/month, 100 GB-hours serverless function execution, 10s default function timeout (extendable to 60s on Pro). The 10s limit aligns with the PRD's uncached render target.
- **No custom build pipeline:** Vercel's built-in Next.js builder is the right choice. No Docker, no custom builders.
- **Preview deployments per PR:** Each pull request gets a unique URL. This is the primary QA gate before merging to `develop`.

### Effort

- 2 hours (project creation, linking, config file authoring, first deploy smoke test)

### Dependencies

- Frontend engineer must have initialized the Next.js project (`npx create-next-app`) and pushed to GitHub first.

---

## 2. Upstash Redis Provisioning

### What to do

- Create a free-tier Upstash Redis database via the Upstash console (or via Vercel Marketplace integration).
- Select the **US East 1 (Virginia)** region to co-locate with Vercel's default serverless region (`iad1`).
- Use the **REST API** (`@upstash/redis`), not raw Redis protocol. REST is purpose-built for serverless: no persistent connections, no connection pool exhaustion, works in Edge and Node runtimes.
- Install `@upstash/redis` and `@upstash/ratelimit` packages.

### Files to create/modify

| File | Purpose |
|------|---------|
| `lib/cache.ts` | Upstash Redis client initialization + cache get/set with 15-min TTL |
| `lib/rateLimiter.ts` | Upstash Ratelimit: sliding window, 10 req/min per IP |
| `.env.local` | Local development credentials (gitignored) |
| `.env.example` | Template showing required vars (committed, no values) |

### Environment variable naming

```
UPSTASH_REDIS_REST_URL=https://us1-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

These names match the Upstash SDK defaults, so `Redis.fromEnv()` works out of the box. No custom naming.

### Key decisions

- **REST over native Redis protocol:** Serverless functions are ephemeral. TCP connections are expensive to establish per invocation and Vercel's Node runtime does not support persistent connections across invocations on the free tier. REST eliminates this entirely.
- **Vercel Marketplace integration vs. manual:** Prefer the Vercel Marketplace integration. It auto-provisions the environment variables into Vercel's env var store, eliminating manual copy-paste and reducing the chance of credential mismatch between environments.
- **Single database for cache + rate limiting:** One Upstash database serves both purposes. At free-tier scale (10K commands/day), there is no contention. Separate databases add operational complexity for zero benefit at this scale.

### Free tier limits

| Resource | Limit | Concern threshold |
|----------|-------|-------------------|
| Commands/day | 10,000 | Each page load = ~2 commands (rate limit check + cache get/set). ~3,300 page loads/day before hitting the wall. |
| Max data size | 256 MB | Each cached thread is ~50-200 KB. ~1,200-5,000 cached threads before hitting the wall. With 15-min TTL, this is not a realistic concern. |
| Max request size | 1 MB | Largest cached thread (500 comments) should stay under 500 KB. Safe. |

### Effort

- 1 hour (provision database, configure integration, write `.env.example`, verify connectivity)

### Dependencies

- None. This can be done day 1, before any application code exists.

---

## 3. CI/CD Pipeline

### What to do

- Create a GitHub Actions workflow that runs on every push and PR.
- Pipeline stages: install, lint, type-check, test, build.
- Vercel handles deployment automatically via its GitHub integration (not via GitHub Actions). Do not duplicate deployment in CI.
- Branch strategy per `CLAUDE.md`: `feature/*` --> `develop` (preview) --> `main` (production).
- Block merges to `develop` if CI fails (enforce via GitHub branch protection rules).

### Files to create/modify

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI pipeline |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist (optional but recommended) |

### `.github/workflows/ci.yml` structure

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run test
      - run: npm run build
        env:
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL_CI }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN_CI }}
```

### Key decisions

- **Vercel handles deploys, GitHub Actions handles quality gates.** This avoids maintaining deployment scripts and leverages Vercel's zero-config deploy previews. CI only validates that the code is correct.
- **Separate Upstash instance for CI (optional):** For build-time validation, the build must succeed. If `lib/cache.ts` initializes the Redis client at import time and the env vars are missing, the build fails. Two options: (a) create a separate free-tier Upstash database for CI, or (b) make the Redis client initialization lazy so the build succeeds without credentials. **Recommend option (b):** lazy initialization. It is simpler and avoids managing a second database.
- **No E2E tests in CI for Phase 1:** Playwright E2E tests are listed in `CLAUDE.md` but are a heavier lift. Add them in a follow-up iteration, not the initial pipeline. Unit/integration tests via Vitest are the Phase 1 gate.
- **Node 20 LTS:** Matches Vercel's default Node runtime. Pin it explicitly to avoid drift.

### Branch protection rules (GitHub Settings)

- `develop`: Require status checks to pass (CI workflow). Require PR reviews (optional for solo dev, recommended for team). Squash merge only.
- `main`: Require status checks to pass. Require PR from `develop` only (no direct pushes). Squash merge.

### Effort

- 3 hours (workflow authoring, secrets configuration, branch protection setup, first green run)

### Dependencies

- Requires `package.json` with `lint`, `test`, and `build` scripts defined (frontend engineer).

---

## 4. Environment Management

### What to do

- Define three environments: local, preview (Vercel), production (Vercel).
- Document all required environment variables and their sources.
- Ensure `.env.local` is gitignored. Provide `.env.example` as a template.
- Use `vercel env pull` to sync Vercel env vars to `.env.local` for local development.

### Files to create/modify

| File | Purpose |
|------|---------|
| `.env.example` | Template with variable names, no values |
| `.gitignore` | Ensure `.env*` (except `.env.example`) is excluded |

### Environment variable inventory

| Variable | Local | Preview | Production | Source |
|----------|-------|---------|------------|--------|
| `UPSTASH_REDIS_REST_URL` | `.env.local` | Vercel env vars (auto via Marketplace) | Vercel env vars (auto via Marketplace) | Upstash console / Vercel Marketplace |
| `UPSTASH_REDIS_REST_TOKEN` | `.env.local` | Vercel env vars (auto via Marketplace) | Vercel env vars (auto via Marketplace) | Upstash console / Vercel Marketplace |
| `NODE_ENV` | `development` (auto) | `production` (auto) | `production` (auto) | Set by runtime |

That is the complete list for Phase 1. There are no API keys, no OAuth tokens, no third-party service credentials beyond Upstash. This is a deliberately minimal secret surface.

### Key decisions

- **Same Upstash database for preview and production:** At free-tier scale with a solo developer, a single database is sufficient. The 15-min TTL means preview and production share cache, which is actually beneficial (preview warms the cache for production). If the team grows or traffic increases, split into separate databases per environment.
- **No `.env.production` file:** Production secrets live exclusively in Vercel's env var store. Never in the repo, never in a dotfile that could be committed.
- **`vercel env pull` for local dev:** This command downloads Vercel env vars into `.env.local`. It is the canonical way to keep local dev in sync without manually copying credentials.

### Effort

- 1 hour

### Dependencies

- Upstash provisioning (Section 2) must be complete first.

---

## 5. Domain & DNS

### What to do

- For Phase 1, use the default Vercel domain: `thread-cartographer.vercel.app` (or similar, depending on availability).
- SSL is automatic and free via Vercel (Let's Encrypt). No configuration needed.
- If a custom domain is desired later, add it via Vercel dashboard and update DNS (CNAME or A record) at the registrar.

### Files to create/modify

None for Phase 1.

### Key decisions

- **No custom domain for MVP:** Adds cost and complexity for zero user-facing benefit on a portfolio project. The `.vercel.app` domain is sufficient. Revisit if the project gains traction.
- **Preview domain aliases:** Vercel automatically generates unique URLs for each deployment. The `develop` branch can optionally be aliased to a stable preview URL via `vercel alias` if desired.

### Effort

- 0 hours (Phase 1). 1 hour if a custom domain is added later.

### Dependencies

- None.

---

## 6. Monitoring & Alerting

### What to do

- Leverage Vercel's built-in analytics and Upstash's built-in dashboard. No third-party monitoring tools for Phase 1.
- Set up Vercel Speed Insights (free, built-in) for Core Web Vitals.
- Monitor Upstash dashboard for cache metrics.
- Establish alerting thresholds (manual checks for Phase 1; automated alerts are a Phase 2+ concern).

### What to monitor

| Metric | Source | Target | Alert threshold |
|--------|--------|--------|-----------------|
| Function execution time (p95) | Vercel dashboard (Runtime Logs) | < 5s cached, < 10s uncached | > 8s cached or > 15s uncached |
| Function error rate | Vercel dashboard | < 1% | > 5% sustained over 1 hour |
| Cache hit rate | Upstash dashboard | >= 70% (PRD requirement) | < 50% sustained over 24 hours |
| Daily command usage | Upstash dashboard | < 10,000/day | > 7,000/day (70% of free tier) |
| Memory usage | Upstash dashboard | < 256 MB | > 200 MB (78% of free tier) |
| Bandwidth | Vercel dashboard | < 100 GB/month | > 70 GB/month |
| Lighthouse performance score | Manual Lighthouse audit | >= 80 | < 75 |

### Files to create/modify

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Add `<SpeedInsights />` component from `@vercel/speed-insights/next` |

### Key decisions

- **No Datadog/Sentry/PagerDuty for Phase 1:** The project is a $0/month portfolio app. Vercel and Upstash dashboards provide sufficient observability. Adding third-party monitoring introduces cost and complexity that is not justified until the project has real users.
- **Manual alert checking:** For a solo developer, a weekly check of the Upstash and Vercel dashboards is sufficient. Automated alerting is warranted only if the project goes into sustained production use.
- **Structured logging in API routes:** Use `console.log` with JSON structure (`{ event, threadId, duration, cacheHit }`) so Vercel Runtime Logs are searchable. Not a separate logging service, just disciplined `console.log`.

### Effort

- 2 hours (Speed Insights setup, establish baseline metrics, document thresholds)

### Dependencies

- Requires at least one successful deployment to see Vercel metrics.
- Requires application code (`app/layout.tsx`) to exist for Speed Insights integration.

---

## 7. Performance & Limits

### Vercel free tier (Hobby plan) limits

| Resource | Limit | Projected usage (Phase 1) | When it becomes a constraint |
|----------|-------|--------------------------|------------------------------|
| Bandwidth | 100 GB/month | < 1 GB/month (portfolio project) | Unlikely in Phase 1 |
| Serverless function execution | 100 GB-hours/month | Minimal | Unlikely in Phase 1 |
| Function duration | 10 seconds max | Uncached large threads may approach this | If Reddit is slow to respond. Mitigation: cache aggressively, optimize parsing. |
| Deployments | 100/day | < 10/day during active dev | Not a concern |
| Serverless functions per deployment | 12 | 1 API route (`/api/thread`) | Not a concern |
| Build time | 45 minutes max | < 2 minutes expected | Not a concern |

### Upstash free tier limits

| Resource | Limit | Projected usage (Phase 1) | When it becomes a constraint |
|----------|-------|--------------------------|------------------------------|
| Commands/day | 10,000 | ~100-500 (personal use + testing) | If shared publicly and goes viral: ~3,300 page loads/day max. Mitigation: consider upgrading to Pay-As-You-Go ($0.2/100K commands). |
| Data size | 256 MB | < 10 MB (15-min TTL keeps this low) | Not a concern with TTL in place |
| Max connections | 1,000 concurrent | REST API = connectionless | Not applicable (using REST) |
| Requests/second | 1,000 | < 10 during normal use | Not a concern |

### Key decisions

- **10-second function timeout is the tightest constraint.** The Vercel Hobby plan caps serverless functions at 10 seconds. The PRD allows 10 seconds for uncached requests. This means the entire flow (rate limit check, cache check, Reddit fetch, parse, cache write, response) must complete in under 10 seconds. If Reddit's `.json` endpoint is slow (>5s), this becomes risky. Mitigation: start the cache write asynchronously (fire-and-forget) and return the response immediately.
- **Upstash 10K commands/day is the second-tightest constraint.** Each request uses 2-3 commands (rate limit + cache read + optional cache write). Practical limit is ~3,300-5,000 unique page loads/day. This is more than sufficient for a portfolio project but would require an upgrade if the project is featured on Hacker News or similar.

### Effort

- 1 hour (document limits, set up monitoring thresholds from Section 6)

### Dependencies

- None.

---

## 8. Security Hardening

### What to do

- Configure security headers in `next.config.ts`.
- Verify rate limiting works end-to-end.
- Verify URL allowlisting rejects non-Reddit URLs.
- Set CORS policy to same-origin only (the API is consumed by its own frontend, not by third parties).

### Files to create/modify

| File | Purpose |
|------|---------|
| `next.config.ts` | Security headers via `headers()` config |

### Security headers

```javascript
// next.config.ts -- headers() section
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];
```

Note on CSP: D3's force simulation runs in a Web Worker, which may require `worker-src 'self'` to be added. Test during implementation and adjust. The `script-src` directive should be kept as strict as possible -- if D3 requires relaxation, document why.

### CORS policy

The `/api/thread` route is consumed only by the app's own frontend. No CORS headers are needed (same-origin requests do not require CORS). If the API is opened to third parties in the future, add explicit `Access-Control-Allow-Origin` headers at that time.

### Rate limiting verification

Write an integration test (`tests/api/rateLimit.test.ts`) that:
1. Sends 10 requests from the same IP within 1 minute -- all should return 200.
2. Sends an 11th request -- should return 429 with `Retry-After` header.
3. Waits for the window to reset and sends another request -- should return 200.

### URL allowlisting verification

Write a unit test (`tests/lib/urlValidation.test.ts`) that:
1. Accepts `https://www.reddit.com/r/AskReddit/comments/t0ynr/some_title/` -- valid.
2. Accepts `https://reddit.com/r/programming/comments/abc123/title.json` -- valid.
3. Rejects `https://evil.com/r/AskReddit/comments/t0ynr/` -- invalid domain.
4. Rejects `https://reddit.com/r/AskReddit/` -- not a thread URL.
5. Rejects `https://reddit.com/api/morechildren` -- not a thread URL.

### Key decisions

- **Strict CSP from day one:** Start strict, loosen only with documented justification. This is easier than starting loose and trying to tighten later.
- **No CORS headers:** Same-origin only. This is a security benefit, not a limitation.
- **HSTS preload:** Since Vercel provides SSL automatically, enable HSTS with a long max-age. This is free security.

### Effort

- 3 hours (header configuration, CSP tuning/testing, rate limit integration test, URL validation test)

### Dependencies

- Rate limiter implementation (`lib/rateLimiter.ts`) from backend engineer.
- URL validation logic from backend engineer.

---

## 9. Rollback Strategy

### What to do

- Document the rollback procedure using Vercel's built-in instant rollback feature.
- Establish a pre-promotion testing checklist for preview deployments.
- Define what constitutes a "bad deploy" that warrants rollback.

### Rollback procedure

1. **Identify the issue:** Vercel Runtime Logs, user report, or monitoring alert.
2. **Instant rollback via Vercel dashboard:** Go to Deployments, find the last known good production deployment, click the three-dot menu, select "Promote to Production." This is atomic and takes < 30 seconds.
3. **CLI alternative:** `vercel rollback` (or `vercel promote <deployment-url>`).
4. **Post-rollback:** Open an issue documenting what broke and why. Fix on a feature branch, test in preview, then re-deploy.

### Pre-promotion testing checklist (before merging `develop` to `main`)

- [ ] Preview deployment loads without errors.
- [ ] Paste a Reddit thread URL -- graph renders within 10 seconds.
- [ ] Paste the same URL again -- response comes from cache (< 5 seconds).
- [ ] Paste a non-Reddit URL -- 400 error is returned.
- [ ] Open browser DevTools -- no console errors, no failed network requests.
- [ ] Run Lighthouse on the preview URL -- performance score >= 80.
- [ ] Check Upstash dashboard -- no anomalous command spikes.

### What constitutes a bad deploy

- API route returns 500 errors on valid Reddit URLs.
- Graph fails to render (blank canvas, JavaScript errors).
- Cache is not working (every request hits Reddit directly).
- Rate limiting is not working (no 429 responses under load).
- Security headers are missing (check with `curl -I`).

### Files to create/modify

| File | Purpose |
|------|---------|
| `docs/RUNBOOK.md` | Operational runbook including rollback procedure (create when project is production-ready, not during initial build) |

### Effort

- 1 hour (document procedure, test rollback on a preview deployment)

### Dependencies

- At least two successful production deployments (need something to roll back to).

---

## 10. Local Development Environment

### What to do

- Provide a local Redis instance for development so developers are not dependent on Upstash (and do not consume free-tier commands during development).
- Create a `docker-compose.yml` with a Redis container.
- Provide npm scripts for common operations.
- Document the setup process.

### Files to create/modify

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Local Redis instance |
| `.env.example` | Template for local env vars |
| `package.json` | Add convenience scripts |

### `docker-compose.yml`

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis-data:/data
volumes:
  redis-data:
```

### Local development approach: two options

**Option A: Use local Redis with `ioredis` in dev, Upstash REST in prod.**
This requires conditional client initialization in `lib/cache.ts` -- use `ioredis` when `NODE_ENV === 'development'` and `@upstash/redis` in production. Adds complexity but avoids consuming Upstash free-tier commands during development.

**Option B: Use Upstash for all environments.**
Simpler code (one Redis client). Free-tier commands are consumed during local dev. At ~10-50 commands per dev session, this is negligible.

**Recommendation: Option B (Upstash everywhere) for Phase 1.** The simplicity outweighs the cost savings. The free tier gives 10,000 commands/day -- a solo developer will use < 500/day in local dev. Provide the Docker Compose file anyway for developers who prefer local Redis or for offline development, but make it optional.

If Option B is chosen, `lib/cache.ts` must still support a local Redis fallback for offline development or CI. Use environment variable presence to switch:

```
if UPSTASH_REDIS_REST_URL is set   --> use @upstash/redis REST client
else if REDIS_URL is set           --> use ioredis for local Redis (docker-compose)
else                               --> no-op cache (passthrough, no caching) for CI builds
```

### npm scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "redis:up": "docker compose up -d redis",
    "redis:down": "docker compose down",
    "env:pull": "vercel env pull .env.local"
  }
}
```

### Setup documentation

Include setup instructions in the project README (or a `CONTRIBUTING.md` if the project is open-sourced). Steps:

1. Clone the repo.
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in Upstash credentials (or run `vercel env pull`).
4. (Optional) `npm run redis:up` for local Redis.
5. `npm run dev` -- app runs on `http://localhost:3000`.

### Effort

- 2 hours (Docker Compose, env template, npm scripts, setup docs)

### Dependencies

- Upstash provisioning (Section 2) for `.env.example` values.
- `package.json` must exist (frontend engineer initializes the project).

---

## Summary: Effort Estimates & Sequencing

| Section | Effort | Can start | Blocked by |
|---------|--------|-----------|------------|
| 2. Upstash Redis Provisioning | 1 hour | Day 1 | Nothing |
| 4. Environment Management | 1 hour | Day 1 | Section 2 |
| 10. Local Dev Environment | 2 hours | Day 1 | `package.json` existing |
| 1. Vercel Deployment Setup | 2 hours | Day 1 | Next.js project initialized on GitHub |
| 3. CI/CD Pipeline | 3 hours | Day 2 | `package.json` with lint/test/build scripts |
| 6. Monitoring & Alerting | 2 hours | After first deploy | Section 1 |
| 7. Performance & Limits | 1 hour | Day 1 (documentation) | Nothing |
| 8. Security Hardening | 3 hours | After API route exists | Backend engineer's route + rate limiter |
| 9. Rollback Strategy | 1 hour | After first production deploy | Section 1 |
| 5. Domain & DNS | 0 hours | N/A (Phase 1) | Nothing |

**Total estimated effort: ~16 hours (2 working days)**

### Recommended execution order

1. **Day 1 morning:** Provision Upstash (Section 2), set up environment management (Section 4), document performance limits (Section 7).
2. **Day 1 afternoon:** Create Vercel project and deploy config (Section 1), set up local dev environment (Section 10). Requires the Next.js project skeleton to exist.
3. **Day 2 morning:** Build CI/CD pipeline (Section 3). Requires lint/test/build scripts.
4. **Day 2 afternoon:** Security hardening (Section 8). Requires the API route to exist for header testing and rate limit verification.
5. **After first production deploy:** Monitoring baseline (Section 6), rollback procedure validation (Section 9).

---

## Appendix: Cross-Team Dependency Map

| I need from... | What | When |
|----------------|------|------|
| Frontend engineer | Next.js project initialized (`create-next-app`) and pushed to GitHub | Before Section 1 |
| Frontend engineer | `package.json` with `lint`, `test`, `build` scripts | Before Section 3 |
| Frontend engineer | `app/layout.tsx` exists | Before Section 6 (Speed Insights) |
| Backend engineer | `lib/cache.ts` and `lib/rateLimiter.ts` implemented | Before Section 8 (verification testing) |
| Backend engineer | `app/api/thread/route.ts` implemented | Before Section 8 (header + rate limit testing) |

| I provide to... | What | When |
|-----------------|------|------|
| All engineers | Upstash credentials in `.env.example` + Vercel env vars | Day 1 |
| All engineers | Working `npm run dev` with local Redis option | Day 1 |
| All engineers | CI pipeline catching lint/test failures before merge | Day 2 |
| All engineers | Preview deployment URLs for every PR | Day 1 (after Vercel setup) |
