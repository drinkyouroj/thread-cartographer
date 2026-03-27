# CLAUDE.md — Thread Cartographer

> This file is the authoritative guide for Claude Code and any AI agent working in this
> repository. Read it fully before taking any action. It is committed to the repo root
> and applies to every session.

**Project:** Thread Cartographer
**Purpose:** An interactive web app that visualizes Reddit comment threads as explorable force-directed graphs. Paste a URL, see conversation structure.
**Last updated:** 2026-03-27
**PRD:** `docs/decisions/DECISION-001-thread-cartographer-prd.md` — the authoritative spec. Read it before any implementation work.

---

## Environment & Stack

**Language(s):** TypeScript
**Framework(s):** Next.js (App Router), D3.js (force layout + zoom)
**Database(s):** Upstash Redis (caching + rate limiting)
**Key dependencies:** DOMPurify (HTML sanitization), AFINN word list (sentiment scoring), d3-force, d3-zoom
**Runtime:** Node 20

### Setup

```bash
# Install dependencies
npm install

# Run locally
npm run dev          # port 3000

# Run tests
npm run test         # Vitest (unit/integration)
npx playwright test  # Playwright (E2E)

# Lint
npm run lint

# Production build
npm run build
```

> Always verify the environment is set up before suggesting code changes.
> Never assume a dependency is installed.

---

## Architecture

```
app/
  page.tsx                      — URL input + visualization container
  api/thread/route.ts           — validates URL, checks rate limit, delegates to DataSource
components/
  ThreadGraph.tsx               — D3 Canvas force graph (client component)
  NodeDetail.tsx                — slide-out comment detail panel
  ControlPanel.tsx              — depth slider, score filter, color legend
lib/
  dataSource.ts                 — DataSource interface (the critical abstraction)
  redditJsonDataSource.ts       — Reddit .json implementation of DataSource
  cache.ts                      — Upstash Redis caching layer (15-min TTL)
  types.ts                      — CommentNode, ThreadEdge, ThreadData
  sentiment.ts                  — AFINN-based sentiment scoring
  rateLimiter.ts                — Per-IP rate limiting (Upstash Redis)
  sanitize.ts                   — DOMPurify wrapper for comment HTML
workers/
  forceLayout.worker.ts         — D3 force simulation in Web Worker
```

### DataSource Interface

All Reddit fetching goes through `DataSource`. No component or route touches Reddit directly. This is the project's most important architectural decision — it allows swapping the data source (official API, test fixtures, cached dumps) by changing one file.

```typescript
interface DataSource {
  fetchThread(url: string): Promise<ThreadData>;
  isValidUrl(url: string): boolean;
}
```

See `lib/types.ts` for `CommentNode`, `ThreadEdge`, and `ThreadData` definitions (specified in PRD §4.4).

### Infrastructure (build FIRST, before any UI)

1. **Redis caching** — Upstash, 15-min TTL on all Reddit responses. Key by normalized thread URL. Not optional — it is the product's immune system against rate limits.
2. **Per-IP rate limiting** — 10 req/min on `/api/thread`. Return 429 + `Retry-After`.
3. **URL allowlisting** — Only proxy `reddit.com/r/*/comments/*` patterns. Reject all else with 400.
4. **User-Agent** — All Reddit requests include `ThreadCartographer/1.0`.

---

## Key Technical Constraints

### Reddit .json API
- Rate limit: 60 req/min unauthenticated, 100/min with OAuth
- 1000-item wall: max ~1000 items per listing
- `/api/morechildren` is fragile — do NOT recursively fetch it. Render "load more" stub nodes instead.
- Platform risk: undocumented endpoint, could be restricted at any time

### Visualization
- **500-comment cap** — threads exceeding this show top-level + 2 levels with "load more" stubs
- **Canvas rendering** (not SVG) — required for performance at 500 nodes
- **Web Worker** — D3 force simulation runs off-main-thread
- **D3.js only** — no Three.js/3D in Phase 1
- **Color-blind-safe palette**: blue (positive), gray (neutral), orange (negative). No red/green.
- **Dark mode** — Dark background with light nodes as default. High contrast for graph readability.
- **Data table alternative** *(stretch goal)* — Tabular view of comment data, sortable by score/depth/author.

### Accessibility
- Color-blind-safe sentiment palette: blue (positive), gray (neutral), orange (negative)
- All interactive controls (panel, sliders, filters) keyboard-navigable
- Detail panel openable/closable via keyboard (Enter to open, Escape to close)
- ARIA labels on graph controls and interactive elements
- Data table alternative view (Phase 1 stretch goal → Phase 2 requirement if not shipped)

### Security
- Sanitize all comment HTML via DOMPurify before rendering
- URL allowlisting prevents open-relay abuse
- No user data stored server-side (stateless)

---

## Success Metrics (Phase 1)

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Deployment | Live on Vercel within 4 weeks | Vercel dashboard |
| Performance | Lighthouse score ≥80 with 500-comment thread | Lighthouse CLI |
| Cache effectiveness | Hit rate ≥70% after 50+ unique threads | Upstash dashboard |
| Abuse prevention | Zero open-relay incidents in first 30 days | Vercel/Upstash logs |
| Functional coverage | All 10 acceptance criteria passing | Manual testing checklist |
| Accessibility | Keyboard-navigable controls; Lighthouse a11y ≥70 | Manual + Lighthouse audit |

---

## Acceptance Criteria (Phase 1)

All 10 must pass before Phase 1 is considered complete:

1. Paste a Reddit thread URL → force-directed graph renders within 5s (cached) / 10s (uncached, ≤500 comments)
2. Nodes sized by score, colored by sentiment (color-blind-safe)
3. Pan/zoom works smoothly (no perceptible frame drops)
4. Click node → detail panel with sanitized comment text
5. Depth slider and score filter dynamically update the graph
6. Threads >500 comments show capped view with "load more" stubs
7. Same thread within 15 min → served from cache
8. >10 req/min from one IP → 429 response
9. Non-Reddit URLs → 400 response
10. Control panel and detail panel fully keyboard-navigable

### Reference Threads for Testing
- **Large thread (cap test):** `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/.json` (~43K comments)
- **Small thread (full-render test):** Choose a thread with ≤500 comments and document its URL in the test plan

---

## Testing Conventions

**Framework:** Vitest (unit/integration), Playwright (E2E)

### Rules

- Every new function or endpoint gets a test in the same PR that introduces it.
- Tests live in `tests/` mirroring the source structure (e.g., `lib/reddit.ts` → `tests/lib/reddit.test.ts`).
- Test names follow `test_<what>_<condition>_<expected>` — e.g. `test_parse_empty_input_returns_none`.
- No PR merges to `develop` with failing tests.
- Prefer narrow unit tests over broad integration tests unless the integration is the thing under test.

### Running Tests

```bash
# All unit/integration tests
npm run test

# Specific file
npx vitest tests/lib/reddit.test.ts

# With coverage
npx vitest --coverage

# E2E tests
npx playwright test

# Specific E2E test
npx playwright test tests/e2e/thread-graph.spec.ts
```

---

## Git Flow & Commit Conventions

### Branch Model

```
main          ← production-ready releases only. Tag every merge.
develop       ← integration branch. All features land here first.
feature/*     ← one branch per feature or fix. Branched from develop.
release/*     ← cut from develop when ready to ship. Merged to main + develop.
hotfix/*      ← branched from main. Merged to both main + develop.
```

### Rules

- `main` and `develop` are **protected**. No direct commits. PRs only.
- Branch names: `feature/short-description`, `fix/short-description`, `chore/short-description`.
- Delete feature branches after merge.
- Every merge to `main` gets a version tag: `vMAJOR.MINOR.PATCH`.

### Semantic Versioning

Follow [semver](https://semver.org/):

| Change type | Version bump |
|---|---|
| Breaking change / incompatible API | MAJOR |
| New feature, backward-compatible | MINOR |
| Bug fix, backward-compatible | PATCH |

### Commit Message Format

Follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — wrap at 72 chars]

[optional footer — BREAKING CHANGE, closes #issue]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`

**Examples:**

```
feat(api): add /api/thread endpoint with URL validation
fix(graph): handle zero-score nodes without crashing
chore(deps): upgrade d3-force to 3.0
test(sentiment): add coverage for neutral-score edge case
```

### Commit Granularity

Commit per logical change — not per file, not per hour. Each commit leaves the codebase in a valid state.

**Anti-patterns:**
- Batching unrelated changes into one commit ("misc fixes")
- Splitting a single logical change across multiple commits
- "WIP" commits on shared branches
- Committing commented-out code

### Pull Requests

- PR title = Conventional Commit format: `feat(scope): description`
- PR description must include: what changed, why, and how to test it.
- Link any related DECISION doc.
- Squash-merge feature branches into develop.
- Merge-commit (no squash) release and hotfix branches into main.

---

## Adversarial Agent Protocol (AAP)

**This is not a standard build. Every significant decision goes through a three-agent
review before implementation.** This is not bureaucracy — it is how the product gets
hardened before it ships.

### The Three Agents

**ARCHITECT** — Designs the solution. Writes code. Makes tradeoffs explicit.
Always asks: *"Is this the simplest thing that works and can be extended?"*

**ADVERSARY** — Attacks the design before and after implementation. Finds edge cases,
security holes, data loss scenarios, and UX failure modes.
Persona: a senior engineer who has been burned by exactly this kind of thing before.
Never lets a decision pass without at least two specific objections.

**JUDGE** — Listens to both. Decides. Writes the final implementation decision as a
one-line verdict followed by any required design changes. Does not compromise for the
sake of harmony.

### When AAP Is Required

Run the Adversarial Agent Protocol for:

- New API endpoints
- Database schema decisions
- Auth or payment flows
- Async job designs
- User-facing error messages that touch data or privacy
- Any change flagged in a DECISION doc as "requires AAP"

For everything else (typo fixes, styling, doc updates, trivial refactors) — skip it.

### Protocol Format

When AAP is triggered, structure the output like this:

```
## AAP: {{decision title}}

### ARCHITECT
{{Design proposal. Be specific. Name the files, functions, data shapes, failure modes
you've considered. State tradeoffs explicitly.}}

### ADVERSARY
**Objection 1:** {{specific attack}}
**Objection 2:** {{specific attack}}
[additional objections if warranted]

### JUDGE
**Verdict:** {{one sentence}}
{{Any required design changes before implementation proceeds.}}
```

### Rules

- ADVERSARY must raise **at least two** specific objections. "Looks fine" is not allowed.
- JUDGE must reference ADVERSARY's objections by number in the verdict if overruling them.
- If JUDGE sides with ADVERSARY, ARCHITECT must revise before any code is written.
- AAP output should be committed to `docs/decisions/` as part of the DECISION doc for
  the change it covers.
- Do not shortcut the protocol under time pressure.

---

## Documentation Conventions

### build_log.md

`build_log.md` lives at the repo root. It is append-only. Every session that makes
meaningful changes should add an entry:

```
## {{YYYY-MM-DD}} — {{short description}}

### Done
- <bullet per logical change>

### Decisions
- <any DECISION docs created or referenced>

### Next
- <what's left or blocked>
```

### DECISION Docs

Before implementing any of the following, a DECISION doc is required:
- New API endpoints
- Database schema changes
- Auth or payment flows
- Async job designs

DECISION docs live in `docs/decisions/` and follow this template:

```markdown
# DECISION: {{title}}

**Date:** {{YYYY-MM-DD}}
**Status:** Proposed | Accepted | Rejected | Superseded

## Context
What problem are we solving? Why now?

## Options Considered
1. **Option A** — pros / cons
2. **Option B** — pros / cons

## Decision
What we're doing and why.

## Consequences
What changes, what gets harder, what gets easier.
```

### README.md

`README.md` must contain at minimum:
- Project name and one-paragraph purpose
- Prerequisites and local setup steps
- How to run tests
- Links to key DECISION docs

Keep it current. If setup steps change, update README in the same PR.

### CHANGELOG.md

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format.
Update it as part of every release PR (never retroactively).

```markdown
## [Unreleased]

## [{{version}}] — {{YYYY-MM-DD}}
### Added
### Changed
### Fixed
### Removed
```

### Architecture Overview

`docs/architecture.md` is a living document describing the high-level system.
Update it when a PR meaningfully changes system topology, data flow, or key
component responsibilities. A rough diagram (ASCII or Mermaid) is encouraged.

---

## Port Assignments

| Service     | Port |
|-------------|------|
| Next.js dev | 3000 |
| Redis       | 6379 |

> Before adding a new service, check this table. Never assign a port already in use.
> Add new assignments to this table as part of the PR that introduces the service.

---

## Phase 1 Non-Goals

Do not build these in Phase 1:
- OAuth / authenticated Reddit requests
- User accounts or saved state
- Three.js / 3D rendering
- Recursive `/api/morechildren` fetching
- Real-time updates or WebSockets
- Mobile-optimized layout
- Multiple visualization modes (tree, radial, timeline)
- Shareable graph snapshots or embeds
