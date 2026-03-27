# DECISION: Thread Cartographer — Product Requirements Document

**Date:** 2026-03-27
**Status:** Accepted
**AAP Review:** Completed (see appendix)

---

## 1. Problem Statement

Reddit threads are information-rich but structurally opaque. The platform's linear UI
hides conversation topology — who replied to whom, where debate forks, where consensus
forms, where the funny tangents live. No polished, publicly available tool exists to
visualize this structure interactively.

Thread Cartographer makes conversation shape visible and explorable. Paste a Reddit
thread URL, get an interactive force-directed graph of the comment tree.

---

## 2. Target Users

**Primary:** Developers, researchers, data enthusiasts, and power Reddit users who want
to understand *how* conversations unfold, not just *what* was said.

**Secondary:** Journalists analyzing discourse patterns, community moderators
investigating thread dynamics, educators using Reddit threads as discussion case studies.

**Non-users (explicitly):** Casual Reddit browsers looking for a better reading
experience (that's Phase 2's territory), anyone expecting real-time updates or
notifications.

---

## 3. Success Metrics

All metrics are measurable with tools already in the stack or freely available.

### Phase 1 MVP

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Deployment** | Live on Vercel within 4 weeks of starting Phase 1 | Vercel dashboard |
| **Performance** | Lighthouse performance score ≥80 with a 500-comment thread loaded | Lighthouse CLI against reference thread¹ |
| **Cache effectiveness** | Cache hit rate ≥70% after 50+ unique threads fetched | Upstash dashboard metrics |
| **Abuse prevention** | Zero open-relay incidents in first 30 days | Vercel/Upstash logs — no non-Reddit domains proxied |
| **Functional coverage** | All 10 acceptance criteria (§4.3) passing | Manual testing checklist |
| **Accessibility baseline** | Control panel and detail panel fully keyboard-navigable; color-blind-safe palette verified | Manual testing + Lighthouse accessibility audit ≥70 |

¹ **Reference threads for performance testing:**

- **Truncation/cap test (large thread):**
  `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/.json`
  (~43K comments) — verifies the 500-comment cap, "load more" stub rendering, and
  performance when the raw thread far exceeds the cap.

- **Full-render test (small thread):**
  Choose a thread with ≤500 comments (`num_comments` field in the `.json` response) to
  verify the graph renders the complete comment tree with no truncation. Document the
  chosen thread URL in the test plan.

### What We Are NOT Measuring

- Vanity metrics (shares, mentions, upvotes about the tool)
- User retention (no accounts exist in Phase 1)
- Revenue (out of scope for entire project)

---

## 4. Phase 1 — Thread Cartographer MVP

**Timeline:** 4 weeks
**Monthly cost at hobby scale:** $0

### 4.1 Core Features

1. **URL input** — text field accepting any `reddit.com/r/*/comments/*` URL pattern.
   Validates format client-side before fetching. Rejects all other URLs.

2. **Reddit fetch + parse** — Hit `{url}.json`, parse Reddit's nested comment structure
   into a flat adjacency list of nodes (comments) and edges (reply relationships).
   Handle `"kind": "more"` objects gracefully by rendering "load more" stub nodes.

3. **Force-directed graph (Canvas)** — D3 force-directed layout rendered on HTML Canvas
   (not SVG). Nodes sized by comment score. Edges represent reply relationships.
   Simulation runs in a Web Worker to keep the UI responsive.

4. **Sentiment color-coding** — AFINN word list scoring. Color palette must be
   **color-blind-safe**: blue (positive), gray (neutral), orange (negative). No
   red/green encoding.

5. **Pan/zoom** — d3-zoom with smooth transitions. Mouse wheel zoom, click-drag pan.

6. **Node detail panel** — Click a node to open a slide-out panel showing: full comment
   text (sanitized via DOMPurify), author, score, depth level, permalink to original
   comment. Panel is keyboard-navigable (Tab/Escape to open/close).

7. **Control panel** — Depth slider (filter by reply depth), minimum score threshold,
   collapse/expand branches, color legend. All controls keyboard-accessible.

8. **500-comment cap** — For threads exceeding 500 comments, display top-level comments
   plus 2 levels of replies. Remaining branches show "load more" stub nodes (no
   recursive fetching of `/api/morechildren`).

9. **Dark mode** — Dark background with light nodes as default. High contrast for graph
   readability.

10. **Data table alternative** *(stretch goal)* — A tabular view of the same comment
    data for users who cannot interact with the graph. Sortable by score, depth, author.

### 4.2 Infrastructure (build first)

These components are shared infrastructure. Build and test them before any UI work.

- **Redis caching (Upstash)** — 15-minute TTL on all Reddit API responses. Key by
  normalized thread URL. This is not optional — it is the product's immune system
  against rate limits.

- **Per-IP rate limiting** — 10 requests per minute per IP on the `/api/thread` route.
  Return 429 with `Retry-After` header.

- **URL allowlisting** — The API route only proxies URLs matching Reddit thread patterns.
  Reject everything else with 400.

- **User-Agent header** — All Reddit requests include `ThreadCartographer/1.0`.

- **DataSource interface** — All Reddit fetching is abstracted behind an interface (see
  §4.4) so the data source can be swapped within a day of refactoring.

### 4.3 Acceptance Criteria

Phase 1 is complete when all of the following pass:

1. User can paste a valid Reddit thread URL and see a force-directed graph render within
   5 seconds (cached) or 10 seconds (uncached, ≤500 comments).
2. Graph nodes are sized by score and colored by sentiment using a color-blind-safe
   palette.
3. Pan/zoom works smoothly (no frame drops perceptible on reference hardware).
4. Clicking a node opens the detail panel with sanitized comment text.
5. Depth slider and score filter dynamically update the visible graph.
6. Threads with >500 comments display a capped view with "load more" stubs.
7. Repeated requests for the same thread within 15 minutes are served from cache.
8. A single IP sending >10 requests/minute receives 429 responses.
9. Non-Reddit URLs submitted to the API route receive 400 responses.
10. Control panel and detail panel are fully navigable via keyboard (Tab, Enter, Escape).

### 4.4 DataSource Interface

This is the critical architectural abstraction. All consumers interact with this
interface, never with Reddit directly.

```typescript
// lib/types.ts

interface CommentNode {
  id: string;
  author: string;
  body: string;           // raw markdown
  bodyHtml: string;       // rendered + sanitized HTML
  score: number;
  depth: number;
  parentId: string | null;
  permalink: string;
  createdUtc: number;
  isStub: boolean;        // true for "load more" placeholders
  childCount?: number;    // for stubs: how many children are hidden
}

interface ThreadEdge {
  source: string;         // parent comment ID
  target: string;         // child comment ID
}

interface ThreadData {
  threadId: string;
  title: string;
  subreddit: string;
  author: string;
  url: string;
  score: number;
  commentCount: number;   // total comments per Reddit metadata
  nodes: CommentNode[];
  edges: ThreadEdge[];
  fetchedAt: number;      // Unix timestamp
  isTruncated: boolean;   // true if 500-cap was applied
}

// lib/dataSource.ts

interface DataSource {
  /**
   * Fetch and normalize a thread into a flat node/edge graph.
   * Implementations handle caching internally.
   * Throws on invalid URL, rate limit exceeded, or fetch failure.
   */
  fetchThread(url: string): Promise<ThreadData>;

  /**
   * Check if a URL is a valid target for this data source.
   */
  isValidUrl(url: string): boolean;
}
```

A `RedditJsonDataSource` class implements this interface for the `.json` endpoint. Future
implementations could wrap the official Reddit API, a local JSON dump, or a test fixture.

### 4.5 Architecture

```
app/
  page.tsx                      — URL input + visualization container
  api/thread/route.ts           — validates URL, checks rate limit, delegates to DataSource
components/
  ThreadGraph.tsx               — D3 Canvas force graph (client component)
  NodeDetail.tsx                — slide-out comment detail panel
  ControlPanel.tsx              — depth slider, score filter, color legend
lib/
  dataSource.ts                 — DataSource interface
  redditJsonDataSource.ts       — Reddit .json implementation
  cache.ts                      — Upstash Redis caching layer
  types.ts                      — CommentNode, ThreadEdge, ThreadData, etc.
  sentiment.ts                  — AFINN-based sentiment scoring
  rateLimiter.ts                — Per-IP rate limiting (Upstash Redis)
  sanitize.ts                   — DOMPurify wrapper for comment HTML
workers/
  forceLayout.worker.ts         — D3 force simulation in Web Worker
```

### 4.6 Non-Goals (Phase 1)

- OAuth / authenticated Reddit requests
- User accounts or saved state
- Three.js / 3D rendering
- Recursive `/api/morechildren` fetching
- Real-time updates or WebSocket connections
- Mobile-optimized layout (functional on mobile, not optimized)
- Multiple visualization modes (tree, radial, timeline)
- Shareable graph snapshots or embeds

---

## 5. Phase 2 — AskReddit Story Explorer

**Timeline:** 3 weeks (only after Phase 1 ships)
**Monthly cost at hobby scale:** $0

### 5.1 Go/No-Go Gate

Phase 2 does NOT start until all of the following are true:

1. **Phase 1 is deployed to production** on Vercel and has been stable for ≥1 week.
2. **Phase 1 has been personally validated** against ≥10 diverse threads of varying
   sizes, subreddits, and content types.
3. **A specific differentiator is documented** in a DECISION doc (`DECISION-002-*`)
   with:
   - A clear description of what the feature does
   - Competitive analysis showing why existing tools (Reddit search, Readit, Upvoted,
     etc.) don't do this
   - Confirmation that it can be built within the 3-week time-box
4. **The builder can articulate in one sentence** what makes this better than browsing
   Reddit's top posts directly. If the answer is "it looks nicer," skip Phase 2.

### 5.2 Core Features

- Browse top AskReddit threads (sorted by score, filterable by time range)
- Surface long-form responses (filter by character length + score)
- Clean, distraction-free reading-mode UI
- Content sensitivity filtering (NSFW tags, basic keyword filter)
- **[One differentiating feature TBD — see go/no-go gate]**

### 5.3 Infrastructure Reuse

The following are shared with Phase 1 and must not be reimplemented:

- `DataSource` interface and `RedditJsonDataSource`
- `lib/cache.ts` (Upstash caching layer)
- `lib/rateLimiter.ts` (per-IP rate limiting)
- `lib/sanitize.ts` (XSS prevention)

New components: reading UI, story filtering logic, possibly ISR for popular threads.

### 5.4 Non-Goals (Phase 2)

- User accounts or bookmarking
- Community curation / voting
- Email or push notifications
- Full-text search across all AskReddit history

---

## 6. Phase 3+ — Future Extensions

These are optional and depend on sustained motivation and validated user interest.
None should be started without a DECISION doc.

### 6.1 Thread Cartographer v2

- Multiple visualization modes: radial tree, Reingold-Tilford, timeline view
- Raise cap to 1,000 nodes with level-of-detail rendering
- Shareable graph snapshots (static image export + OG image for social sharing)
- Embed support (iframe-friendly mode for blog posts)
- Full data table alternative view (promoted from Phase 1 stretch goal if not shipped)

### 6.2 Subreddit DNA

Community fingerprinting tool. Requires a Python/FastAPI backend for NLP analysis.
Adds a `services/nlp/` directory and Railway deployment. Constrained by Reddit's
1,000-item listing wall — accuracy limitations must be disclosed to users.

### 6.3 Reddit Digest

Personal email/RSS briefing. CRUD + cron pattern. Explicitly a **personal utility
only** — monetizing repackaged Reddit content without a data license is legally risky.

---

## 7. Technical Constraints (All Phases)

### Reddit .json API

- **Rate limit:** 60 req/min unauthenticated, 100/min with OAuth
- **1,000-item wall:** Max ~1,000 items per listing endpoint
- **`/api/morechildren`:** Fragile — sometimes returns HTML, 500s on large threads
- **Search API:** Inconsistent results, indexing delays, stricter rate limits
- **Platform risk:** Undocumented endpoint. Reddit has progressively restricted API
  access since 2023. Could be restricted at any time.

### Architectural Imperative

**Treat the Reddit data source as a replaceable plugin.** All fetching goes through the
`DataSource` interface. The caching layer is not an optimization — it is infrastructure
survival. A source swap (to official API, cached dumps, or test fixtures) should require
changes in exactly one file: the `DataSource` implementation.

### Security

- All comment HTML sanitized via DOMPurify before rendering
- URL allowlisting on the API route — no arbitrary URL proxying
- Per-IP rate limiting to prevent abuse as an open relay
- No user-submitted data stored server-side (stateless in Phase 1)

### Accessibility

- Color-blind-safe sentiment palette: **blue** (positive), **gray** (neutral),
  **orange** (negative)
- All interactive controls (panel, sliders, filters) keyboard-navigable
- Detail panel openable/closable via keyboard (Enter to open, Escape to close)
- ARIA labels on graph controls and interactive elements
- Data table alternative view (Phase 1 stretch goal → Phase 2 requirement if not
  shipped)

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Reddit .json endpoint disappears | Critical | DataSource interface allows swap within 1 day. Cache preserves recently-fetched data. |
| Rate limits degrade UX | High | 15-min TTL cache. Display data freshness to user ("fetched 3 min ago"). |
| D3 chokes on large threads | High | 500-node hard cap. Web Worker offloads simulation. Canvas (not SVG) rendering. |
| Open relay abuse | High | URL allowlisting + per-IP rate limiting + request pattern validation. |
| Phase 2 lacks differentiator | Medium | Explicit go/no-go gate (§5.1). Don't start without documented competitive advantage. |
| Scope creep | Medium | Hard 4-week time-box per phase. Ship what exists at deadline. |
| Graph inaccessible to some users | Medium | Color-blind-safe palette, keyboard nav, data table fallback. |
| No users | Medium | Portfolio project — user count is a bonus, not a requirement. Value is in the build. |

---

## 9. Out of Scope (Entire Project)

- Mobile-native applications
- User authentication / accounts (until Phase 3+)
- Monetization of any kind
- Real-time / WebSocket updates
- Three.js / 3D rendering
- Moderation tools or content takedown features
- Integration with Reddit's official OAuth API (deferred — .json is sufficient for MVP)

---

## Appendix: AAP Review

### ARCHITECT
Proposed the PRD structure and content covering all three phases, DataSource
abstraction, 500-comment cap, Canvas rendering, Web Worker simulation, and
infrastructure-first build order.

### ADVERSARY
Raised four objections:
1. Success metrics were unmeasurable with available tools
2. Phase 2 go/no-go gate was too vague
3. No accessibility story (color-blind-hostile palette, no keyboard nav spec)
4. DataSource interface was mentioned but never defined

### JUDGE
**Verdict:** All four objections sustained. Required changes:
1. Replaced soft metrics with Lighthouse scores, Upstash dashboard data, and a reference
   thread for performance testing
2. Added formal Phase 2 go/no-go checklist with four specific criteria
3. Mandated blue/gray/orange color-blind-safe palette, keyboard navigation as Phase 1
   requirement, data table view as stretch goal
4. Included full TypeScript interface definition for DataSource, CommentNode, ThreadEdge,
   and ThreadData

All changes incorporated into the final PRD above.
