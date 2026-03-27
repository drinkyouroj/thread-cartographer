# Frontend / UI / UX Implementation Plan

**Project:** Thread Cartographer -- Phase 1 MVP
**Role:** Senior Frontend / UI / UX Engineer
**Date:** 2026-03-26
**Baseline documents:** `DECISION-001-thread-cartographer-prd.md`, `CLAUDE.md`

---

## 1. Component Architecture & Build Order

### Dependency Graph

```
lib/types.ts                        (shared types -- no deps)
    |
    +-- lib/sentiment.ts            (AFINN scoring -- depends on types)
    |
    +-- workers/forceLayout.worker.ts  (D3 force sim -- depends on types)
    |
    +-- components/ControlPanel.tsx  (filters/legend -- depends on types)
    |       |
    |       +-- components/ThreadGraph.tsx  (Canvas graph -- depends on worker, sentiment, control state)
    |       |
    |       +-- components/NodeDetail.tsx   (detail panel -- depends on types)
    |
    +-- components/UrlInput.tsx      (URL entry -- depends on types for ThreadData)
    |
    +-- app/page.tsx                 (orchestrator -- depends on all above)
    |
    +-- styles/theme.css             (CSS custom properties -- no deps)
```

### Build Order

| Phase | What | Rationale |
|-------|------|-----------|
| **F1** | `lib/types.ts`, `lib/sentiment.ts`, `styles/theme.css` | Foundational types, color palette, CSS variables. Zero dependencies. |
| **F2** | `workers/forceLayout.worker.ts` | Core computational engine. Can be tested in isolation with mock data before any UI exists. |
| **F3** | `components/ThreadGraph.tsx` | Canvas rendering + worker integration. Largest single component. |
| **F4** | `components/ControlPanel.tsx` | Filter state management and bidirectional binding to graph. |
| **F5** | `components/NodeDetail.tsx` | Slide-out panel. Needs graph click events wired. |
| **F6** | `components/UrlInput.tsx` | URL validation, fetch trigger, loading/error states. |
| **F7** | `app/page.tsx` | Orchestration: composes all components, manages top-level state. |
| **F8** | Accessibility audit, data table stretch goal | Polish pass after core features work end-to-end. |

### Files to Create

| File | Purpose |
|------|---------|
| `styles/theme.css` | CSS custom properties for dark mode, color-blind-safe palette |
| `lib/types.ts` | CommentNode, ThreadEdge, ThreadData, FilterState (per PRD section 4.4) |
| `lib/sentiment.ts` | AFINN word-list scoring + color mapping |
| `lib/sanitize.ts` | DOMPurify wrapper (thin, but isolates the dependency) |
| `lib/graphUtils.ts` | Node sizing math, edge bundling, layout helpers |
| `workers/forceLayout.worker.ts` | D3 force simulation off-main-thread |
| `components/UrlInput.tsx` | URL input with validation and loading states |
| `components/ThreadGraph.tsx` | Canvas-rendered force-directed graph |
| `components/ControlPanel.tsx` | Depth slider, score threshold, collapse/expand, legend |
| `components/NodeDetail.tsx` | Slide-out comment detail panel |
| `app/page.tsx` | Page shell, state orchestration |
| `app/layout.tsx` | Root layout with metadata, font loading, theme CSS import |
| `app/globals.css` | Tailwind base + custom global styles |

### Key Technical Decisions

- **State management:** React `useState` + `useReducer` at `page.tsx` level. No external state library needed for Phase 1 -- the state graph is shallow (thread data, filter state, selected node). If props drill more than 2 levels deep, introduce a Context for filter state only.
- **Client vs. server components:** `page.tsx` will be a server component that renders client component children. All interactive components (`ThreadGraph`, `ControlPanel`, `NodeDetail`, `UrlInput`) are `"use client"`.
- **D3 integration:** Import D3 modules individually (`d3-force`, `d3-zoom`, `d3-scale`) -- not the full `d3` bundle. Keeps the client JS lean.

### Estimated Effort

F1: 0.5 day | F2: 1.5 days | F3: 3 days | F4: 1.5 days | F5: 1 day | F6: 1 day | F7: 1 day | F8: 1.5 days
**Total: ~11 days frontend work**

### Dependencies on Other Team Members

- F6 (UrlInput) depends on `app/api/thread/route.ts` being functional (backend team).
- F3 (ThreadGraph) can be developed against mock `ThreadData` fixtures before the API route is ready.
- `lib/sanitize.ts` is shared infrastructure (listed in both frontend and backend plans). Whoever builds it first, the other consumes it.

---

## 2. D3.js Force Graph Implementation

### Canvas Rendering Strategy

**File:** `components/ThreadGraph.tsx`

The graph renders on an HTML `<canvas>` element, not SVG. At 500 nodes with edges, SVG would create 1000+ DOM elements, each requiring layout and paint. Canvas draws to a single bitmap -- O(1) DOM nodes regardless of graph size.

**Rendering pipeline:**

1. `ThreadGraph` mounts a `<canvas>` element via `useRef`.
2. On mount (and when `ThreadData` changes), it posts node/edge data to the Web Worker.
3. The worker runs D3 force simulation ticks and posts back updated `{x, y}` positions per node on each tick (throttled to ~30fps during warm-up, 60fps once stabilized).
4. The main thread's `requestAnimationFrame` loop reads the latest positions and draws to Canvas.
5. Drawing order: edges first (thin lines), then nodes (filled circles), then labels (only for nodes above a size threshold to avoid clutter).

**Node rendering details:**

- Node radius: `clamp(3, sqrt(score) * 1.5, 20)` -- square root scale prevents high-score outliers from dominating.
- Node color: mapped from sentiment score via the color-blind-safe palette (see Section 7).
- Stub nodes ("load more"): rendered as dashed-outline circles with a `+N` label.
- Edge rendering: straight lines, 1px stroke, `rgba(255,255,255,0.15)` in dark mode. No arrowheads in Phase 1 (visual clutter at 500 edges).

### Web Worker Setup

**File:** `workers/forceLayout.worker.ts`

**Message protocol (see also Section 10):**

```
Main -> Worker:
  { type: "INIT", nodes: SimNode[], edges: SimEdge[], config: ForceConfig }
  { type: "FILTER", visibleNodeIds: string[] }
  { type: "STOP" }

Worker -> Main:
  { type: "TICK", nodes: { id: string, x: number, y: number }[], alpha: number }
  { type: "STABILIZED" }
  { type: "ERROR", message: string }
```

**Force configuration:**

- `forceLink`: edge-based, distance proportional to parent depth difference.
- `forceManyBody`: repulsion, strength -30. Clamped charge for stub nodes (weaker, so they cluster at periphery).
- `forceCenter`: centers the graph in the viewport.
- `forceCollide`: radius-based collision to prevent node overlap.
- `alphaDecay`: 0.02 (slower decay = smoother settle, but cap at 300 ticks max to ensure stabilization within ~5 seconds).

**Worker lifecycle:**

- Created once when `ThreadGraph` mounts. Terminated on unmount.
- `INIT` message resets the simulation for a new thread.
- `FILTER` message applies visibility changes (from depth/score filters) without restarting the full simulation -- it freezes filtered-out nodes and re-warms alpha to 0.3 for a brief re-settle.

### Performance Targets at 500 Nodes

| Metric | Target |
|--------|--------|
| Time to first stable layout | < 3 seconds |
| Frame rate during interaction (pan/zoom) | 60fps |
| Frame rate during simulation warm-up | 30fps minimum |
| Main thread long tasks during simulation | None (all sim work in worker) |
| Memory (heap) for graph data | < 10MB |
| Canvas redraw time per frame | < 8ms |

### Key Technical Decisions

- **Individual D3 module imports:** `d3-force`, `d3-zoom`, `d3-scale`, `d3-selection` only. No full `d3` bundle.
- **Typed arrays for worker transfer:** Node positions sent as `Float32Array` in transferable messages once the graph exceeds 200 nodes. Below that threshold, plain JSON is fine.
- **No hit-testing on every mousemove:** Use a spatial index (quadtree, built by D3 already during force sim) for O(log n) node lookup on hover/click.

### Estimated Effort

- Web Worker + message protocol: 1.5 days
- Canvas rendering pipeline: 2 days
- Integration + performance tuning: 1 day
- **Total: ~4.5 days** (overlaps with F2+F3 from Section 1)

### Dependencies

- `lib/types.ts` must be finalized first (defines `CommentNode`, `ThreadEdge`).
- Backend team provides mock `ThreadData` fixture for development.

---

## 3. Interaction Design

### Pan/Zoom

**Library:** `d3-zoom` applied to the canvas element.

**Implementation:**

- `d3.zoom()` attached to a transparent `<svg>` overlay (or directly to the canvas). Using an SVG overlay is cleaner because d3-zoom expects DOM event targets, and it avoids conflicts with canvas hit-testing. The SVG overlay is invisible (pointer-events only) and sits atop the canvas via CSS `position: absolute`.
- Transform state (`{x, y, k}`) stored in a React ref -- not state, because zoom/pan updates at 60fps and `setState` would be too expensive.
- Transform applied to the canvas rendering context via `ctx.setTransform(k, 0, 0, k, x, y)` at the start of each frame.
- Zoom limits: `scaleExtent([0.1, 8])` -- prevents zooming so far out that nodes become invisible or so far in that a single node fills the viewport.
- Smooth animated transitions on programmatic zoom (e.g., "zoom to fit" button, click-to-center-on-node).

### Node Click -> Detail Panel

1. User clicks on canvas.
2. Canvas click handler transforms screen coordinates to graph coordinates using the inverse of the current zoom transform.
3. Quadtree lookup finds the nearest node within a 20px hit radius.
4. If a node is found, `setSelectedNode(node)` triggers the `NodeDetail` panel to slide in.
5. If no node is found (click on empty space), `setSelectedNode(null)` closes the panel.

### Hover States

- On mousemove, perform the same quadtree lookup.
- If hovering a node: change cursor to `pointer`, draw a highlight ring (2px white stroke) around the node, show a tooltip with `author` and `score` (positioned near cursor, clamped to viewport).
- If not hovering a node: cursor returns to `grab` (or `grabbing` during pan).
- Throttle mousemove handler to 16ms (one frame) to avoid jank.

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Cycle focus between: URL input -> Control Panel -> Graph area -> Detail panel (if open) |
| `Enter` | When graph is focused: select the currently highlighted node (opens detail panel) |
| `Escape` | Close detail panel. If detail panel is already closed, deselect current node. |
| `Arrow keys` | When graph is focused: navigate between nodes (move to adjacent connected node in the direction pressed). This is a best-effort spatial mapping -- exact behavior depends on graph layout. |
| `+` / `-` | Zoom in/out when graph is focused |
| `0` | Reset zoom to fit-all when graph is focused |

**Graph focus indicator:** When the canvas area receives focus (via Tab), draw a visible focus ring (2px solid blue outline) around the canvas border. Internally, maintain a `focusedNodeIndex` that arrow keys increment/decrement through the node list.

### Files to Modify/Create

- `components/ThreadGraph.tsx` -- all interaction logic lives here
- `lib/graphUtils.ts` -- quadtree setup, coordinate transforms, hit-testing helpers

### Estimated Effort

- Pan/zoom: 0.5 days (d3-zoom does the heavy lifting)
- Click + detail panel wiring: 0.5 days
- Hover states + tooltip: 0.5 days
- Keyboard navigation: 1 day (most complex due to spatial arrow-key logic)
- **Total: ~2.5 days**

### Dependencies

- ThreadGraph canvas must be rendering (Section 2).
- NodeDetail panel must exist as a component (Section 5).

---

## 4. Control Panel

### Component: `components/ControlPanel.tsx`

**Layout:** Fixed-position panel on the left side of the viewport. Width: 280px on desktop, collapses to an icon-triggered drawer on mobile (see Section 9). Vertically stacked controls.

### Controls

#### 4.1 Depth Slider

- HTML `<input type="range">` with `min=0`, `max={maxDepth}` (derived from data), `step=1`.
- Label shows current value: "Depth: 0 -- {value}".
- Filters nodes to only show those with `depth <= value`.
- Default: max depth (show all).

#### 4.2 Score Threshold

- `<input type="range">` with `min={minScore}`, `max={maxScore}`, `step=1`.
- Label: "Min score: {value}".
- Filters out nodes with `score < value`.
- Default: `minScore` (show all).

#### 4.3 Collapse/Expand Branches

- Click a node in the graph, then click "Collapse" in the control panel to hide all its descendants.
- Collapsed branches show the parent node with a visual indicator (double-ring border).
- "Expand All" button resets all collapsed branches.
- State: `Set<string>` of collapsed node IDs, stored at page level.

#### 4.4 Color Legend

- Static visual legend showing three swatches with labels:
  - Blue circle + "Positive"
  - Gray circle + "Neutral"
  - Orange circle + "Negative"
- Below the swatches: node size legend (small circle = low score, large circle = high score).

### Filter State Flow

```
ControlPanel -- dispatches --> filterReducer (in page.tsx)
    |
    v
FilterState { depthMax: number, scoreMin: number, collapsedIds: Set<string> }
    |
    +---> ThreadGraph (receives as prop, computes visible node IDs, posts FILTER to worker)
    +---> NodeDetail (grays out "collapse" button if selected node has no children)
```

**Key decision:** Filters are applied in the main thread before sending to the worker. The worker only receives visible node IDs and repositions them. This keeps filter logic testable outside the worker.

### Files

- `components/ControlPanel.tsx` -- the panel component
- `app/page.tsx` -- `useReducer` for `FilterState`

### Estimated Effort

- Depth slider + score threshold: 0.5 days
- Collapse/expand logic: 0.5 days
- Color/size legend: 0.25 days
- State wiring to graph: 0.25 days
- **Total: ~1.5 days**

### Dependencies

- `lib/types.ts` for `CommentNode` shape (to derive min/max values).
- ThreadGraph must accept filter state as props.

---

## 5. Node Detail Panel

### Component: `components/NodeDetail.tsx`

### Layout & Animation

- Slide-out panel anchored to the right edge of the viewport.
- Width: 400px on desktop, full-width on mobile.
- Animation: CSS `transform: translateX(100%)` (closed) to `translateX(0)` (open), `transition: transform 200ms ease-out`.
- Overlay: semi-transparent backdrop on mobile only (clicking it closes the panel).
- Max height: viewport height. Content scrolls internally.

### Content Layout (top to bottom)

1. **Header bar:** Close button (X icon, top-right), node depth badge (e.g., "Depth 3").
2. **Author line:** `/u/{author}` as a link to Reddit profile (opens in new tab). Score badge (upvote icon + number). Sentiment badge (colored dot + "Positive"/"Neutral"/"Negative").
3. **Comment body:** Rendered from `bodyHtml` (already sanitized via DOMPurify in the data pipeline). Styled with readable typography: 16px font, 1.6 line-height, max-width for readability.
4. **Metadata footer:** Timestamp (relative, e.g., "2 years ago"), permalink button ("View on Reddit" -- opens in new tab).
5. **Stub node variant:** If `isStub === true`, show "{childCount} comments not loaded" message with an explanation that recursive fetching is not supported in Phase 1.

### Keyboard Interaction

- `Enter` on a focused graph node opens the panel. Focus moves to the panel's close button.
- `Escape` closes the panel. Focus returns to the previously focused graph node.
- `Tab` cycles through interactive elements inside the panel (close button, author link, permalink button).
- Focus trap: while the panel is open, Tab does not escape to elements behind it.

### Files

- `components/NodeDetail.tsx`
- `lib/sanitize.ts` -- DOMPurify wrapper (shared with backend, whoever builds first)

### Estimated Effort

- Panel structure + slide animation: 0.5 days
- Content layout + typography: 0.25 days
- Keyboard interaction + focus trap: 0.5 days
- Stub node variant: 0.25 days
- **Total: ~1.5 days**

### Dependencies

- `lib/types.ts` for `CommentNode` shape.
- `lib/sanitize.ts` for DOMPurify (if sanitization happens client-side as a safety net beyond server-side sanitization).
- Backend team must include `bodyHtml` (pre-sanitized) in `CommentNode`.

---

## 6. URL Input Component

### Component: `components/UrlInput.tsx`

### Validation

**Client-side regex:** `/^https?:\/\/(www\.)?reddit\.com\/r\/\w+\/comments\/\w+/`

- Validate on blur and on submit.
- Show inline error message below the input if validation fails: "Please enter a valid Reddit thread URL (e.g., reddit.com/r/AskReddit/comments/abc123/...)".
- Disable the submit button while input is empty or invalid.

### States

| State | Visual |
|-------|--------|
| Empty | Placeholder text: "Paste a Reddit thread URL..." |
| Typing | No validation feedback until blur or submit |
| Invalid (after blur) | Red border, error message below |
| Submitting | Input disabled, spinner icon replaces submit button text, "Fetching thread..." label |
| Error (fetch failed) | Red banner above input: "{error message}". Input re-enabled for retry. Specific messages for 429 (rate limit), 400 (invalid URL), 500 (Reddit unreachable). |
| Success | Input shrinks into a compact header bar showing thread metadata (see below) |

### Thread Metadata Display (post-fetch)

After a successful fetch, the URL input area transforms into a compact metadata bar:

```
[r/AskReddit] "What is the most downvoted comment..." | 1,247 comments (500 shown) | Score: 3,891 | Fetched 2 min ago
[Change Thread] button
```

- "500 shown" appears only if `isTruncated === true`.
- "Fetched X ago" computed from `fetchedAt` timestamp. Updates every 30 seconds via `setInterval`.
- "Change Thread" button resets to the empty input state.

### Files

- `components/UrlInput.tsx`

### Estimated Effort

- Input + validation: 0.25 days
- Loading/error states: 0.25 days
- Metadata bar: 0.5 days
- **Total: ~1 day**

### Dependencies

- `app/api/thread/route.ts` must be functional to test fetch flow (backend team).
- Can develop against a mock API response in the meantime.

---

## 7. Dark Mode & Theming

### Color Palette

**File:** `styles/theme.css`

All colors defined as CSS custom properties on `:root`. Dark mode is the default and only mode in Phase 1 (PRD says "dark background with light nodes as default"). A light mode toggle is not in scope.

```css
:root {
  /* Background & surfaces */
  --bg-primary: #0d1117;         /* GitHub-dark-like background */
  --bg-surface: #161b22;         /* Card/panel surfaces */
  --bg-elevated: #1c2128;        /* Elevated panels (detail panel, control panel) */
  --bg-overlay: rgba(0,0,0,0.6); /* Modal overlay on mobile */

  /* Text */
  --text-primary: #e6edf3;       /* Primary text */
  --text-secondary: #8b949e;     /* Secondary/muted text */
  --text-link: #58a6ff;          /* Links */

  /* Sentiment palette (color-blind-safe) */
  --sentiment-positive: #4a90d9; /* Blue */
  --sentiment-neutral: #8b949e;  /* Gray */
  --sentiment-negative: #d97b4a; /* Orange */

  /* Graph */
  --edge-color: rgba(255,255,255,0.12);
  --node-highlight: #ffffff;
  --node-stub-border: rgba(255,255,255,0.4);

  /* UI chrome */
  --border-default: #30363d;
  --focus-ring: #58a6ff;
  --error: #f85149;
  --success: #3fb950;

  /* Sizing */
  --panel-width-control: 280px;
  --panel-width-detail: 400px;
  --header-height: 64px;
}
```

### Color-Blind Safety Rationale

The blue/gray/orange palette avoids the red-green axis entirely. Under the three most common color vision deficiencies:

- **Deuteranopia (green-blind):** Blue and orange remain distinguishable. Gray is neutral.
- **Protanopia (red-blind):** Same as above -- blue and orange are not confused.
- **Tritanopia (blue-yellow-blind):** Least common. Blue may shift toward green, but orange remains distinct. The luminance difference between the three colors (blue is mid-luminance, gray is low, orange is high) provides an additional discrimination channel.

We will verify the palette using the Sim Daltonism tool or Coblis simulator before shipping.

### Applying Theme

- All components reference CSS variables, never hard-coded color values.
- Canvas rendering reads CSS variable values via `getComputedStyle` at init time and caches them in JS constants for the render loop (reading computed styles per-frame would be expensive).
- Tailwind CSS config (`tailwind.config.ts`) maps these CSS variables to Tailwind utility classes for use in non-canvas UI components: `bg-surface`, `text-primary`, `border-default`, etc.

### Files

- `styles/theme.css` -- custom property definitions
- `tailwind.config.ts` -- extend theme with CSS variable references
- `app/globals.css` -- import theme.css, set `body` defaults
- `app/layout.tsx` -- set `<html class="dark">` and appropriate meta theme-color

### Estimated Effort

- CSS variables + palette definition: 0.25 days
- Tailwind config integration: 0.25 days
- Verify across components: 0.25 days
- Color-blind simulation testing: 0.25 days
- **Total: ~1 day**

### Dependencies

None -- this is foundational and should be built in F1 before any component work.

---

## 8. Accessibility

### Keyboard Navigation Plan

**Full keyboard flow (Tab order):**

```
1. URL Input (text field + submit button)
2. Thread metadata bar (Change Thread button) -- only when a thread is loaded
3. Control Panel
   3a. Depth slider
   3b. Score threshold slider
   3c. Collapse/Expand All button
4. Graph canvas (custom focus management)
   4a. Arrow keys navigate between nodes
   4b. Enter selects node (opens detail panel)
   4c. +/- zoom, 0 reset zoom
5. Node Detail Panel (when open -- focus-trapped)
   5a. Close button
   5b. Author link
   5c. View on Reddit link
   5d. Escape closes panel, returns focus to graph
```

### ARIA Labels

| Element | ARIA attribute |
|---------|---------------|
| Canvas | `role="img"`, `aria-label="Force-directed graph of {commentCount} comments from r/{subreddit}"` |
| Depth slider | `aria-label="Filter by comment depth"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` |
| Score slider | `aria-label="Minimum comment score filter"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` |
| Detail panel | `role="dialog"`, `aria-label="Comment detail"`, `aria-modal="true"` |
| Close button | `aria-label="Close detail panel"` |
| Legend swatches | `role="img"`, `aria-label="Color legend: blue is positive sentiment, gray is neutral, orange is negative"` |
| Submit button | `aria-label="Fetch thread"` (when in loading state: `aria-label="Fetching thread..."`, `aria-busy="true"`) |

### Color-Blind Safety

- Sentiment encoding uses blue/gray/orange (no red/green) per PRD mandate.
- Node size provides a second visual channel (redundant with color for sentiment -- high-score nodes tend positive, but size encodes score, not sentiment, so this is complementary, not redundant).
- Legend explicitly labels each color with text.
- Will test with Sim Daltonism across all three deficiency types.

### Screen Reader Considerations

- The canvas graph is inherently inaccessible to screen readers. We mitigate this with:
  - An `aria-label` on the canvas summarizing the graph.
  - The data table alternative (stretch goal) provides full access to the same data.
  - The detail panel (which IS accessible) shows all information for any selected node.

### Data Table Alternative (Stretch Goal)

**File:** `components/DataTable.tsx`

If time permits:

- Sortable HTML table with columns: Author, Score, Depth, Sentiment, Body (truncated), Permalink.
- Toggle between graph view and table view via a tab-style switcher.
- Table uses standard HTML `<table>` semantics (headers, row scoping) for full screen reader support.
- Sortable columns via `aria-sort` attributes.

### Lighthouse Accessibility Target

- Score >= 70 (PRD requirement).
- Primary gaps will be the canvas element (inherently limited) -- the data table is the mitigation path.

### Estimated Effort

- ARIA labels on all controls: 0.5 days (integrated into component build, not a separate pass)
- Keyboard navigation wiring: 1 day (main effort is the graph canvas keyboard nav)
- Focus trap for detail panel: 0.25 days
- Color-blind verification: 0.25 days
- Data table stretch goal: 1.5 days (if pursued)
- **Total: ~2 days core + 1.5 days stretch**

### Dependencies

- All components must be built first (accessibility is partially integrated during build, partially a polish pass).

---

## 9. Responsive Behavior

### PRD Mandate

> "Functional on mobile, not optimized."

### Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Desktop | >= 1024px | Control panel (left, 280px) + Canvas (flexible center) + Detail panel (right, 400px, on-demand) |
| Tablet | 768px -- 1023px | Control panel collapses to top horizontal bar. Canvas fills remaining space. Detail panel is full-width slide-up from bottom. |
| Mobile | < 768px | Control panel behind hamburger menu (slide-out drawer). Canvas fills viewport. Detail panel is full-screen overlay. |

### Desktop Layout

```
+-------------------+-----------------------------+------------------+
| Control Panel     |                             | Detail Panel     |
| (280px fixed)     |   Canvas (flex: 1)          | (400px, hidden   |
|                   |                             |  until node      |
| Depth slider      |   Force-directed graph      |  click)          |
| Score filter      |                             |                  |
| Collapse/Expand   |                             |                  |
| Legend             |                             |                  |
+-------------------+-----------------------------+------------------+
```

### Mobile Adaptations

- **Canvas:** `width: 100vw`, `height: calc(100vh - var(--header-height))`. Touch events mapped to d3-zoom (d3-zoom handles touch natively -- pinch-to-zoom, single-finger pan).
- **Node selection:** Tap instead of click. Increase hit radius from 20px to 30px to account for finger size.
- **Control panel:** Collapsed behind a gear icon in the header. Opens as a slide-over drawer with backdrop.
- **Detail panel:** Full-screen overlay with a swipe-down-to-close gesture (stretch -- CSS-only slide-up is the MVP).
- **URL input:** Full-width. On-screen keyboard pushes the input up (standard mobile behavior, no special handling needed).

### What We Explicitly Skip on Mobile

- Multi-column layouts
- Hover states (no hover on touch devices -- tooltip info shown on long-press, or not at all)
- Keyboard navigation (mobile users use touch)
- Performance optimization for low-end devices (we target desktop Lighthouse scores)

### Files

- All component files include responsive CSS (Tailwind responsive prefixes: `md:`, `lg:`).
- No separate mobile component variants.

### Estimated Effort

- Responsive CSS across all components: 1 day (spread across component build phases)
- Touch event handling in canvas: 0.5 days (d3-zoom handles most of it)
- Mobile drawer/overlay for panels: 0.5 days
- **Total: ~2 days** (mostly parallel with component builds)

### Dependencies

None -- responsive behavior is built into each component, not a separate phase.

---

## 10. Performance Budget

### Lighthouse Targets

| Category | Target | Notes |
|----------|--------|-------|
| Performance | >= 80 | With a 500-comment thread loaded (PRD requirement) |
| Accessibility | >= 70 | PRD requirement. Canvas inherently limits this score. |
| Best Practices | >= 90 | Standard Next.js defaults get us most of the way. |
| SEO | >= 90 | Not critical for an app like this, but free with Next.js. |

### Canvas vs SVG Justification

| Factor | Canvas | SVG |
|--------|--------|-----|
| DOM nodes for 500-node graph | 1 (`<canvas>`) | ~1,500 (`<circle>`, `<line>`, `<text>`) |
| Render cost per frame | O(n) draw calls, GPU-composited | O(n) DOM re-layouts if positions change |
| Interaction (hit-testing) | Manual (quadtree) | Free (DOM events on elements) |
| Accessibility | Poor (single bitmap) | Better (elements can have ARIA) |
| Memory at 500 nodes | ~2-5 MB | ~15-30 MB (DOM overhead) |
| Zoom/pan performance | Excellent (matrix transform on context) | Degrades (reflow on viewport change) |

**Verdict:** Canvas wins decisively at 500 nodes. SVG's interaction advantage is offset by the quadtree approach, and SVG's accessibility advantage is mitigated by the detail panel and stretch-goal data table.

### Web Worker Message Protocol (Detailed)

```typescript
// workers/forceLayout.worker.ts

// --- Main Thread -> Worker ---

interface InitMessage {
  type: "INIT";
  nodes: Array<{
    id: string;
    score: number;
    depth: number;
    isStub: boolean;
    sentiment: number;  // pre-computed AFINN score
  }>;
  edges: Array<{ source: string; target: string }>;
  config: {
    width: number;      // canvas width for centering force
    height: number;     // canvas height for centering force
    alphaDecay: number; // default 0.02
    maxTicks: number;   // default 300
  };
}

interface FilterMessage {
  type: "FILTER";
  visibleNodeIds: string[];
  warmAlpha: number;    // typically 0.3 for a brief re-settle
}

interface StopMessage {
  type: "STOP";
}

type WorkerInMessage = InitMessage | FilterMessage | StopMessage;

// --- Worker -> Main Thread ---

interface TickMessage {
  type: "TICK";
  // For graphs > 200 nodes, positions sent as Float32Array (transferable)
  // For smaller graphs, sent as plain array
  positions: Float32Array | Array<{ id: string; x: number; y: number }>;
  alpha: number;        // simulation temperature (0 = stable)
}

interface StabilizedMessage {
  type: "STABILIZED";
}

interface ErrorMessage {
  type: "ERROR";
  message: string;
}

type WorkerOutMessage = TickMessage | StabilizedMessage | ErrorMessage;
```

**Tick throttling:** During warm-up (alpha > 0.1), the worker runs simulation ticks as fast as possible but only posts positions to the main thread every 33ms (30fps). Once alpha drops below 0.1, it posts every 16ms (60fps) for smooth final settling. After stabilization, it sends a single `STABILIZED` message and stops posting until the next `INIT` or `FILTER`.

### Bundle Size Budget

| Chunk | Target |
|-------|--------|
| Initial page JS (before thread load) | < 100 KB gzipped |
| D3 modules (d3-force, d3-zoom, d3-scale, d3-selection) | ~40 KB gzipped |
| DOMPurify | ~15 KB gzipped |
| AFINN word list (sentiment) | ~20 KB gzipped (can lazy-load after initial paint) |
| Web Worker script | < 50 KB gzipped |
| Total client JS | < 200 KB gzipped |

**Strategy:** Use Next.js dynamic imports (`next/dynamic`) for `ThreadGraph` and `ControlPanel` so the D3 modules are not in the initial bundle. They load after the URL is submitted.

### Runtime Performance Targets

| Metric | Target | How to measure |
|--------|--------|----------------|
| First Contentful Paint | < 1.5s | Lighthouse |
| Largest Contentful Paint | < 2.5s | Lighthouse |
| Total Blocking Time | < 200ms | Lighthouse |
| Canvas frame time (500 nodes) | < 8ms | `performance.measure()` in render loop |
| Worker message latency | < 2ms | `performance.now()` timestamps in messages |
| Time from URL submit to graph visible | < 5s cached, < 10s uncached | Manual measurement against reference threads |

### Estimated Effort

- Performance measurement instrumentation: 0.5 days
- Optimization pass (lazy loading, bundle analysis): 0.5 days
- Float32Array transfer optimization: 0.25 days
- Lighthouse audit + fixes: 0.5 days
- **Total: ~1.75 days**

### Dependencies

- All components must be built and functional before meaningful performance measurement.
- Backend API route must be functional for end-to-end timing.

---

## Summary: Effort & Timeline

| Section | Core Effort | Stretch |
|---------|------------|---------|
| 1. Component Architecture | (overhead accounted in sections below) | -- |
| 2. D3 Force Graph | 4.5 days | -- |
| 3. Interaction Design | 2.5 days | -- |
| 4. Control Panel | 1.5 days | -- |
| 5. Node Detail Panel | 1.5 days | -- |
| 6. URL Input | 1 day | -- |
| 7. Dark Mode & Theming | 1 day | -- |
| 8. Accessibility | 2 days | 1.5 days (data table) |
| 9. Responsive Behavior | 2 days | -- |
| 10. Performance Budget | 1.75 days | -- |
| **Total** | **~17.75 days** | **+1.5 days** |

At roughly 3.5 working weeks, this fits within the 4-week Phase 1 timeline with buffer for integration issues, testing, and backend coordination.

### Critical Path

```
theme.css + types.ts (F1, 0.5d)
    |
    v
Web Worker (F2, 1.5d) ----+
                           |
                           v
               ThreadGraph (F3, 3d) <-- most complex single component
                           |
              +------------+------------+
              |            |            |
              v            v            v
     ControlPanel     NodeDetail    UrlInput
      (F4, 1.5d)      (F5, 1.5d)   (F6, 1d)
              |            |            |
              +------------+------------+
                           |
                           v
                    page.tsx (F7, 1d)
                           |
                           v
               A11y audit + perf tuning (F8, 2d)
```

F4, F5, and F6 can be built in parallel once F3 is functional. This parallelization is the key to hitting the 4-week timeline.
