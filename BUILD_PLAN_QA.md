# BUILD PLAN: QA & Test Strategy

**Role:** Senior QA Specialist
**Date:** 2026-03-26
**PRD Reference:** `docs/decisions/DECISION-001-thread-cartographer-prd.md`
**Phase:** 1 -- Thread Cartographer MVP

---

## 1. Test Strategy Overview

### Testing Pyramid

| Level | Framework | Scope | Run Context |
|-------|-----------|-------|-------------|
| **Unit** | Vitest | Individual functions and modules in `lib/` | CI on every push, locally via `npm run test` |
| **Integration** | Vitest + supertest/fetch mocks | API route (`/api/thread`) with mocked Redis and Reddit responses | CI on every push |
| **E2E** | Playwright | Full browser flows against a running dev server with fixture data | CI on `develop` merges and pre-release; manual during feature development |

### Guiding Principles

- Tests mirror source structure: `lib/sentiment.ts` --> `tests/lib/sentiment.test.ts`.
- Test names follow `test_<what>_<condition>_<expected>` convention (per CLAUDE.md).
- Every new function or endpoint ships with tests in the same PR.
- No merges to `develop` with failing tests.
- Fixtures live in `tests/fixtures/` and are committed to the repo.
- Mocks are co-located in `tests/mocks/` and kept minimal. Prefer real implementations with injected test doubles over heavy mocking.

### Directory Structure

```
tests/
  fixtures/
    reddit/
      small-thread.json          -- ~50 comments, full tree
      large-thread.json          -- ~600 comments (triggers 500 cap)
      deleted-comments.json      -- thread with [deleted] authors and bodies
      more-stubs.json            -- thread with "kind": "more" objects
      malformed-response.json    -- invalid/unexpected JSON structure
      xss-comments.json          -- comments with script tags, event handlers
  mocks/
    redisClient.mock.ts          -- in-memory Map-based Redis mock
    fetchMock.ts                 -- fetch() mock returning fixture data
  lib/
    sentiment.test.ts
    cache.test.ts
    rateLimiter.test.ts
    sanitize.test.ts
    redditJsonDataSource.test.ts
    dataSource.test.ts
  api/
    thread.route.test.ts
  e2e/
    thread-visualization.spec.ts
    node-detail-panel.spec.ts
    control-panel.spec.ts
    keyboard-navigation.spec.ts
    performance.spec.ts
```

---

## 2. Unit Test Plan

### 2.1 `redditJsonDataSource.ts`

**File:** `tests/lib/redditJsonDataSource.test.ts`
**Estimated effort:** 1.5 days
**Dependencies:** `lib/types.ts` (interface definitions), `lib/cache.ts`, fixture files

| Test Name | Description |
|-----------|-------------|
| `test_parseThread_smallThread_returnsCorrectNodeCount` | Parse `small-thread.json`, verify `nodes.length` matches expected count |
| `test_parseThread_smallThread_returnsCorrectEdgeCount` | Verify `edges.length` equals (nodes - 1) for a fully connected tree |
| `test_parseThread_nestedReplies_preservesParentChildRelationships` | Verify `parentId` on deeply nested comments points to correct parent |
| `test_parseThread_nestedReplies_depthFieldMatchesNestingLevel` | Verify `depth` increments correctly at each nesting level |
| `test_parseThread_moreStubs_createsStubNodes` | Parse `more-stubs.json`, verify nodes with `isStub: true` exist |
| `test_parseThread_moreStubs_stubHasChildCount` | Verify stub nodes have `childCount` set from the "more" object's `count` field |
| `test_parseThread_largeThread_capsAt500Nodes` | Parse `large-thread.json` (>500 comments), verify `nodes.length <= 500` |
| `test_parseThread_largeThread_setsIsTruncatedTrue` | Verify `isTruncated` is `true` when cap is applied |
| `test_parseThread_smallThread_setsIsTruncatedFalse` | Verify `isTruncated` is `false` when all comments fit |
| `test_parseThread_largeThread_includesTopLevelPlusTwoLevels` | Verify capped output contains top-level comments and replies up to depth 2 |
| `test_parseThread_deletedComments_handlesDeletedAuthor` | Verify `[deleted]` author is preserved, node is still created |
| `test_parseThread_deletedComments_handlesDeletedBody` | Verify `[deleted]` or `[removed]` body text is preserved, node is still in graph |
| `test_parseThread_emptyThread_returnsEmptyNodesAndEdges` | Handle a thread with zero comments gracefully |
| `test_parseThread_malformedJson_throwsDescriptiveError` | Malformed Reddit response throws a clear error, not a cryptic crash |
| `test_isValidUrl_validRedditUrl_returnsTrue` | `reddit.com/r/foo/comments/abc123/title/` returns `true` |
| `test_isValidUrl_wwwPrefix_returnsTrue` | `www.reddit.com/r/...` is accepted |
| `test_isValidUrl_oldRedditPrefix_returnsTrue` | `old.reddit.com/r/...` is accepted |
| `test_isValidUrl_nonRedditUrl_returnsFalse` | `https://example.com` returns `false` |
| `test_isValidUrl_redditNonThreadUrl_returnsFalse` | `reddit.com/r/askreddit` (subreddit, not thread) returns `false` |
| `test_isValidUrl_emptyString_returnsFalse` | Empty string returns `false` |
| `test_isValidUrl_maliciousUrl_returnsFalse` | `javascript:alert(1)` and similar payloads return `false` |
| `test_fetchThread_setsUserAgentHeader` | Verify outgoing fetch includes `ThreadCartographer/1.0` User-Agent |
| `test_parseThread_threadMetadata_extractsTitleAndSubreddit` | Verify `title`, `subreddit`, `author`, `score`, `url` are correctly extracted from listing data |

### 2.2 `sentiment.ts`

**File:** `tests/lib/sentiment.test.ts`
**Estimated effort:** 0.5 days
**Dependencies:** AFINN word list (bundled or imported as dependency)

| Test Name | Description |
|-----------|-------------|
| `test_score_positiveText_returnsPositiveScore` | "This is wonderful and great" returns a positive number |
| `test_score_negativeText_returnsNegativeScore` | "This is terrible and awful" returns a negative number |
| `test_score_neutralText_returnsZeroOrNearZero` | "The cat sat on the mat" returns 0 or close to 0 |
| `test_score_emptyString_returnsZero` | Empty string returns exactly 0 |
| `test_score_nullOrUndefined_returnsZero` | Null/undefined input returns 0 without throwing |
| `test_score_mixedSentiment_returnsNetScore` | "Great movie but terrible ending" returns sum of word scores |
| `test_score_unicodeText_doesNotThrow` | Text with emojis, CJK characters, accented letters does not crash |
| `test_score_repeatedWords_scalesLinearly` | "good good good" scores higher than "good" |
| `test_score_casInsensitive_matchesRegardlessOfCase` | "GREAT" scores same as "great" |
| `test_score_punctuationAdjacent_stillMatchesWords` | "great!" matches "great" in the word list |
| `test_score_deletedCommentBody_returnsZero` | "[deleted]" and "[removed]" return 0 |
| `test_classify_positiveScore_returnsPositive` | Score > 0 classifies as "positive" |
| `test_classify_negativeScore_returnsNegative` | Score < 0 classifies as "negative" |
| `test_classify_zeroScore_returnsNeutral` | Score === 0 classifies as "neutral" |

### 2.3 `rateLimiter.ts`

**File:** `tests/lib/rateLimiter.test.ts`
**Estimated effort:** 0.5 days
**Dependencies:** Redis mock (`tests/mocks/redisClient.mock.ts`)

| Test Name | Description |
|-----------|-------------|
| `test_checkLimit_firstRequest_allows` | First request from a new IP is allowed |
| `test_checkLimit_tenthRequest_allows` | 10th request within the window is allowed |
| `test_checkLimit_eleventhRequest_blocks` | 11th request within 1 minute returns blocked status |
| `test_checkLimit_afterWindowExpiry_resetsCounter` | After 60 seconds, counter resets and requests are allowed again |
| `test_checkLimit_differentIPs_trackedIndependently` | Two different IPs each get their own 10-request budget |
| `test_checkLimit_blockedResponse_includesRetryAfterSeconds` | Blocked result includes `retryAfter` value in seconds |
| `test_checkLimit_redisUnavailable_failsOpen` | If Redis is down, requests are allowed (fail-open, not fail-closed) |
| `test_checkLimit_concurrentRequests_counterIsAccurate` | Rapid concurrent increments do not lose counts |

### 2.4 `cache.ts`

**File:** `tests/lib/cache.test.ts`
**Estimated effort:** 0.5 days
**Dependencies:** Redis mock

| Test Name | Description |
|-----------|-------------|
| `test_get_existingKey_returnsCachedData` | Stored data is retrievable |
| `test_get_missingKey_returnsNull` | Non-existent key returns null |
| `test_set_storesWithTTL_expiresAfterTTL` | Data stored with 15-min TTL is absent after expiry (simulated) |
| `test_get_withinTTL_returnsData` | Data is present before TTL expires |
| `test_keyNormalization_trailingSlash_sameKey` | URLs with and without trailing slash produce same cache key |
| `test_keyNormalization_httpVsHttps_sameKey` | `http://` and `https://` variants produce same cache key |
| `test_keyNormalization_wwwVsNonWww_sameKey` | `www.reddit.com` and `reddit.com` produce same cache key |
| `test_keyNormalization_queryParams_stripped` | Query parameters are removed before key generation |
| `test_set_serializesThreadData_deserializesCorrectly` | Full `ThreadData` object survives JSON round-trip |
| `test_get_redisUnavailable_returnsNull` | Redis failure returns null rather than throwing |

### 2.5 `sanitize.ts`

**File:** `tests/lib/sanitize.test.ts`
**Estimated effort:** 0.5 days
**Dependencies:** DOMPurify (or isomorphic-dompurify for Node/test context)

| Test Name | Description |
|-----------|-------------|
| `test_sanitize_scriptTag_removesScript` | `<script>alert(1)</script>` is stripped entirely |
| `test_sanitize_imgOnError_removesHandler` | `<img onerror="alert(1)">` removes the `onerror` attribute |
| `test_sanitize_iframeTag_removesIframe` | `<iframe src="evil.com">` is stripped |
| `test_sanitize_anchorJavascript_removesHref` | `<a href="javascript:alert(1)">` is neutralized |
| `test_sanitize_markdownBold_preservesBold` | `<strong>bold</strong>` is preserved |
| `test_sanitize_markdownItalic_preservesItalic` | `<em>italic</em>` is preserved |
| `test_sanitize_markdownLink_preservesLink` | `<a href="https://example.com">link</a>` is preserved |
| `test_sanitize_markdownList_preservesList` | `<ul><li>item</li></ul>` is preserved |
| `test_sanitize_markdownBlockquote_preservesBlockquote` | `<blockquote>text</blockquote>` is preserved |
| `test_sanitize_markdownCode_preservesCode` | `<code>code</code>` and `<pre>` are preserved |
| `test_sanitize_nestedXSS_removesNestedPayload` | `<div><img src=x onerror=alert(1)>safe text</div>` keeps text, removes img handler |
| `test_sanitize_emptyString_returnsEmptyString` | Empty input returns empty output |
| `test_sanitize_plainText_returnsUnchanged` | Plain text with no HTML passes through unchanged |
| `test_sanitize_svgPayload_removesSVG` | `<svg onload="alert(1)">` is stripped |
| `test_sanitize_dataAttributes_stripsDataUri` | `<a href="data:text/html,...">` is neutralized |

---

## 3. Integration Test Plan

**File:** `tests/api/thread.route.test.ts`
**Estimated effort:** 1.5 days
**Dependencies:** All `lib/` modules implemented, Redis mock, fixture files

These tests exercise the `/api/thread` Next.js route handler with mocked external dependencies (Redis, fetch to Reddit). They verify the modules work together correctly.

| Test Name | Description |
|-----------|-------------|
| `test_apiThread_validUrl_returns200WithThreadData` | POST a valid Reddit URL, receive 200 with well-formed `ThreadData` |
| `test_apiThread_invalidUrl_returns400WithMessage` | POST a non-Reddit URL, receive 400 with error message |
| `test_apiThread_emptyBody_returns400` | POST with no URL in body returns 400 |
| `test_apiThread_nonRedditDomain_returns400` | URL pointing to `evil.com/r/foo/comments/...` returns 400 |
| `test_apiThread_cachedThread_returnsCachedData` | Second request within 15 min returns cached response (verify fetch not called twice) |
| `test_apiThread_cacheExpired_fetchesFreshData` | After TTL expires, a new fetch is made |
| `test_apiThread_rateLimitExceeded_returns429` | 11th request from same IP returns 429 |
| `test_apiThread_rateLimited_includesRetryAfterHeader` | 429 response includes `Retry-After` header |
| `test_apiThread_rateLimitDifferentIPs_bothAllowed` | Two IPs each making 10 requests both succeed |
| `test_apiThread_redditReturns404_returns502` | If Reddit returns 404, API returns appropriate error |
| `test_apiThread_redditReturns500_returns502` | If Reddit returns 500, API returns 502 or similar gateway error |
| `test_apiThread_redditTimeout_returnsTimeout` | If Reddit fetch times out, API returns 504 |
| `test_apiThread_largeThread_returnsTruncatedData` | Thread with >500 comments returns `isTruncated: true` and capped nodes |
| `test_apiThread_responseShape_matchesThreadDataInterface` | Response body conforms to `ThreadData` interface shape |
| `test_apiThread_sanitizedHtml_noScriptTags` | `bodyHtml` fields in response contain no `<script>` tags |
| `test_apiThread_userAgent_sentToReddit` | Outgoing request to Reddit includes `ThreadCartographer/1.0` |

---

## 4. E2E Test Plan (Playwright)

**Estimated effort:** 2 days
**Dependencies:** Fully functional UI (all components), dev server running, fixture server or mock API

### Setup

- Playwright tests run against `localhost:3000` with the Next.js dev server.
- For deterministic tests, intercept `/api/thread` at the network level (Playwright `page.route()`) and return fixture data. This avoids hitting Reddit and makes tests fast and reliable.
- Separate test for actual Reddit fetch (marked as `@slow`, skipped in CI).

### 4.1 Thread Visualization Flow

**File:** `tests/e2e/thread-visualization.spec.ts`

| Test Name | Description |
|-----------|-------------|
| `test_pasteUrl_validThread_graphRendersWithinTimeout` | Paste a URL, verify the canvas element appears and contains rendered content within 5 seconds |
| `test_pasteUrl_invalidUrl_showsErrorMessage` | Enter `https://example.com`, verify an error message is shown |
| `test_pasteUrl_emptyInput_submitDisabled` | Submit button is disabled when input is empty |
| `test_graphRender_nodesVisible_canvasNotEmpty` | After graph loads, canvas is not blank (pixel sampling or aria attributes) |
| `test_graphRender_nodesSizedByScore_variableRadii` | Verify nodes have visually different sizes (screenshot comparison or data attribute) |
| `test_graphRender_sentimentColors_usesColorBlindSafePalette` | Verify nodes use blue/gray/orange palette (not red/green) |

### 4.2 Node Detail Panel

**File:** `tests/e2e/node-detail-panel.spec.ts`

| Test Name | Description |
|-----------|-------------|
| `test_clickNode_opensDetailPanel` | Click on a graph node, verify detail panel slides into view |
| `test_detailPanel_showsCommentText` | Panel displays the comment body text |
| `test_detailPanel_showsAuthor` | Panel displays the author name |
| `test_detailPanel_showsScore` | Panel displays the comment score |
| `test_detailPanel_showsPermalink` | Panel contains a link to the original Reddit comment |
| `test_detailPanel_escapeCloses` | Pressing Escape closes the detail panel |
| `test_detailPanel_sanitizedContent_noXSS` | Comment with XSS payload renders safely (no alert, script stripped) |

### 4.3 Control Panel

**File:** `tests/e2e/control-panel.spec.ts`

| Test Name | Description |
|-----------|-------------|
| `test_depthSlider_adjusting_filtersNodes` | Moving depth slider removes deeper nodes from the graph |
| `test_scoreFilter_adjusting_filtersLowScoreNodes` | Setting a minimum score hides low-score nodes |
| `test_colorLegend_visible_showsSentimentLabels` | Color legend displays positive/neutral/negative labels |
| `test_controlPanel_initialState_showsAllNodes` | On load, all nodes are visible (no filters applied) |

### 4.4 Keyboard Navigation

**File:** `tests/e2e/keyboard-navigation.spec.ts`

| Test Name | Description |
|-----------|-------------|
| `test_tabNavigation_reachesAllControls` | Tab key cycles through URL input, submit, depth slider, score filter, and legend |
| `test_enterKey_submitsUrl` | Pressing Enter in the URL input triggers fetch |
| `test_enterKey_opensDetailPanel` | Pressing Enter on a focused node opens the detail panel |
| `test_escapeKey_closesDetailPanel` | Pressing Escape from the detail panel closes it |
| `test_tabKey_moveThroughDetailPanelLinks` | Tab within the detail panel moves through permalink and close button |
| `test_sliderKeys_arrowKeysAdjustValue` | Arrow keys adjust slider values when slider is focused |

### 4.5 Performance (E2E)

**File:** `tests/e2e/performance.spec.ts`

| Test Name | Description |
|-----------|-------------|
| `test_cachedThread_rendersWithin5Seconds` | Pre-cached thread renders graph within 5s |
| `test_uncachedThread_rendersWithin10Seconds` | Uncached thread (mocked to simulate network delay) renders within 10s |
| `test_panZoom_noFrameDrops` | Pan and zoom interactions do not cause perceptible jank (measured via frame timing) |

---

## 5. Test Data & Fixtures

### Fixture Files

All stored in `tests/fixtures/reddit/`. These are static JSON files that mirror the exact structure Reddit returns from `{url}.json`.

| File | Purpose | Approximate Size | How to Create |
|------|---------|-------------------|---------------|
| `small-thread.json` | Happy path, full tree, ~50 comments | ~50 KB | Manually fetch a small thread's `.json`, save response |
| `large-thread.json` | Triggers 500-comment cap, ~600 comments | ~300 KB | Fetch from a larger thread, save response |
| `deleted-comments.json` | Contains `[deleted]` and `[removed]` comments | ~30 KB | Find a thread with deleted comments or hand-edit a fixture |
| `more-stubs.json` | Contains `"kind": "more"` objects in children arrays | ~40 KB | Most medium threads include these naturally |
| `malformed-response.json` | Broken JSON structure to test error handling | ~1 KB | Hand-craft |
| `xss-comments.json` | Comments containing `<script>`, `onerror=`, etc. | ~5 KB | Hand-craft malicious comment bodies into a valid Reddit JSON structure |
| `empty-thread.json` | Thread with zero comments | ~2 KB | Hand-craft or find a brand-new thread |

### Fixture Maintenance

- Fixtures are committed to git. They do not change frequently.
- If Reddit changes their JSON structure, update fixtures and flag the breakage as a data source risk (per PRD risk table).
- A `tests/fixtures/README.md` documents each fixture's source URL and date captured.
- Fixture creation is a **prerequisite** for unit and integration tests. Budget 0.5 days for initial fixture creation.

### Mock Utilities

| File | Purpose |
|------|---------|
| `tests/mocks/redisClient.mock.ts` | In-memory `Map`-based mock implementing `get`, `set`, `incr`, `expire` methods. Supports simulated TTL expiry via a `advanceTime(ms)` helper. |
| `tests/mocks/fetchMock.ts` | Replaces global `fetch` with a function that returns fixture data based on URL pattern matching. Supports simulating errors, timeouts, and slow responses. |

---

## 6. Acceptance Criteria Verification Matrix

Each of the 10 acceptance criteria from PRD section 4.3 is mapped to specific tests that verify it.

| AC# | Criterion | Tests That Verify It | Test Level |
|-----|-----------|---------------------|------------|
| **AC1** | Paste URL --> graph renders within 5s cached / 10s uncached | `test_pasteUrl_validThread_graphRendersWithinTimeout`, `test_cachedThread_rendersWithin5Seconds`, `test_uncachedThread_rendersWithin10Seconds` | E2E |
| **AC2** | Nodes sized by score, colored by sentiment (color-blind-safe) | `test_graphRender_nodesSizedByScore_variableRadii`, `test_graphRender_sentimentColors_usesColorBlindSafePalette`, `test_classify_*` (sentiment unit tests) | E2E + Unit |
| **AC3** | Pan/zoom works smoothly | `test_panZoom_noFrameDrops` | E2E |
| **AC4** | Click node --> detail panel with sanitized text | `test_clickNode_opensDetailPanel`, `test_detailPanel_showsCommentText`, `test_detailPanel_sanitizedContent_noXSS`, `test_sanitize_*` (sanitize unit tests) | E2E + Unit |
| **AC5** | Depth slider and score filter dynamically update graph | `test_depthSlider_adjusting_filtersNodes`, `test_scoreFilter_adjusting_filtersLowScoreNodes` | E2E |
| **AC6** | Threads >500 comments show capped view with stubs | `test_parseThread_largeThread_capsAt500Nodes`, `test_parseThread_moreStubs_createsStubNodes`, `test_apiThread_largeThread_returnsTruncatedData` | Unit + Integration |
| **AC7** | Same thread within 15 min served from cache | `test_apiThread_cachedThread_returnsCachedData`, `test_get_existingKey_returnsCachedData`, `test_set_storesWithTTL_expiresAfterTTL` | Integration + Unit |
| **AC8** | >10 req/min from one IP --> 429 | `test_checkLimit_eleventhRequest_blocks`, `test_apiThread_rateLimitExceeded_returns429`, `test_apiThread_rateLimited_includesRetryAfterHeader` | Unit + Integration |
| **AC9** | Non-Reddit URLs --> 400 | `test_isValidUrl_nonRedditUrl_returnsFalse`, `test_apiThread_invalidUrl_returns400WithMessage`, `test_apiThread_nonRedditDomain_returns400` | Unit + Integration |
| **AC10** | Control panel and detail panel keyboard-navigable | `test_tabNavigation_reachesAllControls`, `test_enterKey_*`, `test_escapeKey_closesDetailPanel`, `test_sliderKeys_arrowKeysAdjustValue` | E2E |

---

## 7. Performance Testing

### Lighthouse Audit

**Target:** Performance score >= 80 with 500-comment thread loaded.

**Method:**
1. Run Lighthouse CI against the deployed preview URL (or `localhost:3000` with production build).
2. Use the reference large thread from the PRD: `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/.json`
3. Pre-warm cache so the test measures rendering performance, not network fetch.

**Automation:**
- Add `@lhci/cli` as a dev dependency.
- Create `lighthouserc.js` with assertions: `performance >= 0.80`, `accessibility >= 0.70`.
- Run in CI on `develop` merges (not on every push -- too slow).

**File:** `lighthouserc.js` (config at project root)

**Estimated effort:** 0.5 days to configure, then runs automatically.

### Render Time Measurement

| Scenario | Target | How to Measure |
|----------|--------|----------------|
| Cached thread, <= 500 comments | <= 5 seconds from URL submit to graph visible | Playwright: timestamp before submit, `waitForSelector('canvas')`, measure delta |
| Uncached thread, <= 500 comments | <= 10 seconds from URL submit to graph visible | Same method, but with cold cache |
| Large thread (43K comments, cap applied) | <= 10 seconds | Use reference thread URL |

### Reference Threads

- **Large (cap test):** `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/.json`
- **Small (full render):** Select a thread with <= 500 comments during fixture creation. Document the URL in `tests/fixtures/README.md`. Candidate: any recent thread in a smaller subreddit -- verified by checking `num_comments` in the JSON response.

### Web Worker Performance

- Verify force layout simulation completes without blocking the main thread.
- Measure with `performance.mark()` / `performance.measure()` in the worker.
- Not automated in CI; verified during manual performance testing sessions.

---

## 8. Accessibility Testing

### Automated Checks

**File:** Integrated into E2E tests (`tests/e2e/keyboard-navigation.spec.ts`) and Lighthouse config.

| Check | Method | Target |
|-------|--------|--------|
| Lighthouse accessibility score | Lighthouse CI | >= 70 |
| Keyboard navigation (Tab, Enter, Escape) | Playwright E2E tests (section 4.4) | All controls reachable and operable |
| ARIA labels present | Playwright assertions: `expect(locator).toHaveAttribute('aria-label')` | All interactive elements labeled |
| Color contrast ratio | Lighthouse auto-check + manual verification of blue/gray/orange against dark background | WCAG AA (4.5:1 for text, 3:1 for large text/UI) |

### Manual Checks (Pre-Release)

| Check | Method | Owner |
|-------|--------|-------|
| Screen reader walkthrough | VoiceOver (macOS) on the full flow: input URL, navigate graph controls, open detail panel, read comment | QA specialist |
| Color-blind simulation | Chrome DevTools > Rendering > Emulate vision deficiencies (protanopia, deuteranopia, tritanopia) | QA specialist |
| Zoom 200% | Browser zoom to 200%, verify no content is clipped or overlapping | QA specialist |
| Focus indicator visibility | Tab through all controls, verify focus ring is visible on dark background | QA specialist |

### Specific ARIA Requirements

- URL input: `aria-label="Reddit thread URL"`
- Submit button: `aria-label="Visualize thread"`
- Depth slider: `aria-label="Filter by reply depth"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
- Score slider: `aria-label="Minimum comment score"`, same value attributes
- Detail panel: `role="dialog"`, `aria-label="Comment detail"`, `aria-modal="true"`
- Close button: `aria-label="Close detail panel"`
- Color legend: semantic list or `role="list"` with labeled items

**Estimated effort:** 0.5 days automated, 0.5 days manual per release.

---

## 9. Security Testing

### Automated (in unit/integration tests)

| Test Area | Tests | File |
|-----------|-------|------|
| XSS via comment content | `test_sanitize_scriptTag_*`, `test_sanitize_imgOnError_*`, `test_sanitize_svgPayload_*`, `test_detailPanel_sanitizedContent_noXSS` | `sanitize.test.ts`, `node-detail-panel.spec.ts` |
| URL injection | `test_isValidUrl_maliciousUrl_returnsFalse`, `test_apiThread_nonRedditDomain_returns400` | `redditJsonDataSource.test.ts`, `thread.route.test.ts` |
| Open relay prevention | `test_apiThread_nonRedditDomain_returns400`, `test_isValidUrl_nonRedditUrl_returnsFalse` | `thread.route.test.ts`, `redditJsonDataSource.test.ts` |
| Rate limit bypass | `test_checkLimit_eleventhRequest_blocks`, `test_apiThread_rateLimitExceeded_returns429` | `rateLimiter.test.ts`, `thread.route.test.ts` |

### Manual Security Tests (Pre-Release)

Run once before initial deployment and after any security-touching changes.

| Test | Method | Expected Result |
|------|--------|----------------|
| **URL injection via API** | `curl -X POST /api/thread -d '{"url":"https://evil.com/r/foo/comments/abc/"}'` | 400 response |
| **URL with encoded characters** | Submit URL with `%2F`, `%3A` encoded characters to bypass allowlist | 400 response (URL decoded before validation) |
| **SSRF attempt** | Submit `http://169.254.169.254/latest/meta-data/` (AWS metadata) | 400 response |
| **Rate limit with X-Forwarded-For spoofing** | Send requests with varying `X-Forwarded-For` headers | Rate limiting uses trusted IP source (Vercel provides `x-real-ip`), not spoofable header |
| **Large payload attack** | Submit extremely long URL or body | Request rejected by body size limit |
| **Cache poisoning** | Submit URL that normalizes to same key but returns different content | Verify key normalization is consistent |
| **XSS in thread title** | Thread with `<script>` in title displays safely | Title is sanitized |

**Estimated effort:** 0.5 days for automated, 0.5 days for manual.

---

## 10. CI Integration

### Test Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test Suite
on:
  push:
    branches: [develop, main, 'feature/*']
  pull_request:
    branches: [develop]
```

### Pipeline Stages

| Stage | Tests Run | Trigger | Estimated Duration |
|-------|-----------|---------|-------------------|
| **Lint** | `npm run lint` | Every push | ~30s |
| **Unit** | `npx vitest run tests/lib/` | Every push | ~15s |
| **Integration** | `npx vitest run tests/api/` | Every push | ~30s |
| **E2E** | `npx playwright test` (excluding `@slow`) | Merges to `develop`, PRs to `develop` | ~2 min |
| **Lighthouse** | Lighthouse CI against preview deployment | Merges to `develop` only | ~1 min |
| **E2E (slow)** | `npx playwright test --grep @slow` (real Reddit fetch) | Manual trigger only | ~30s per thread |

### Coverage Targets

| Scope | Target | Rationale |
|-------|--------|-----------|
| `lib/` modules (unit) | >= 90% line coverage | These are the core logic modules; high coverage is essential |
| API route (integration) | >= 85% branch coverage | All error paths and happy paths must be tested |
| Overall project | >= 80% line coverage | Practical target given that canvas rendering and Web Worker code are harder to unit test |

### What Is NOT in CI

| Item | Reason | How It Is Verified |
|------|--------|-------------------|
| Manual accessibility audit (screen reader, color-blind sim) | Requires human judgment | QA checklist before each release |
| Manual security penetration tests | One-time or periodic, not per-commit | QA checklist before initial deploy |
| Performance testing against live Reddit | Non-deterministic, depends on Reddit availability | Manual with documented results |
| Visual regression testing | Not in Phase 1 scope; consider for Phase 2 | Manual screenshot comparison |

### CI Configuration Files to Create

| File | Purpose |
|------|---------|
| `.github/workflows/test.yml` | Main test pipeline |
| `vitest.config.ts` | Vitest configuration (already implied by project setup) |
| `playwright.config.ts` | Playwright configuration (base URL, timeouts, browser list) |
| `lighthouserc.js` | Lighthouse CI assertions |

---

## Effort Summary

| Area | Estimated Effort | Dependencies |
|------|-----------------|--------------|
| Fixture creation | 0.5 days | None (can start immediately) |
| Mock utilities | 0.5 days | None |
| Unit tests (`redditJsonDataSource`) | 1.5 days | `lib/types.ts`, `lib/redditJsonDataSource.ts` implemented |
| Unit tests (`sentiment`) | 0.5 days | `lib/sentiment.ts` implemented |
| Unit tests (`rateLimiter`) | 0.5 days | `lib/rateLimiter.ts` implemented, Redis mock |
| Unit tests (`cache`) | 0.5 days | `lib/cache.ts` implemented, Redis mock |
| Unit tests (`sanitize`) | 0.5 days | `lib/sanitize.ts` implemented |
| Integration tests | 1.5 days | All `lib/` modules + API route implemented |
| E2E tests | 2 days | Full UI implemented and functional |
| Performance/Lighthouse setup | 0.5 days | Deployable build exists |
| Accessibility testing (automated) | 0.5 days | UI components implemented |
| Accessibility testing (manual) | 0.5 days | Full app functional |
| Security testing (automated) | Included in unit/integration above | -- |
| Security testing (manual) | 0.5 days | Deployed preview |
| CI pipeline setup | 0.5 days | Test files exist |
| **Total** | **~10 days** | |

### Parallelization Notes

- Fixture creation and mock utilities can start on day 1, before any implementation code exists.
- Unit tests for each module can be written as soon as that module's interface is defined (test-first approach is viable).
- E2E tests require a functional UI and should be written in the final week of Phase 1.
- CI pipeline can be set up as soon as the first unit tests exist.

### Cross-Team Dependencies

| Dependency | Needed By | Blocking? |
|------------|-----------|-----------|
| `lib/types.ts` (interface definitions) | All unit tests | Yes -- must be first deliverable |
| `lib/redditJsonDataSource.ts` | DataSource unit tests | Yes |
| `lib/sentiment.ts` | Sentiment unit tests | Yes |
| `lib/rateLimiter.ts` | Rate limiter unit tests | Yes |
| `lib/cache.ts` | Cache unit tests | Yes |
| `lib/sanitize.ts` | Sanitize unit tests | Yes |
| `app/api/thread/route.ts` | Integration tests | Yes |
| All UI components | E2E tests | Yes |
| Vercel preview deployment | Lighthouse CI, manual security tests | Yes |

---

## Appendix: Test Naming Convention Reference

Per CLAUDE.md: `test_<what>_<condition>_<expected>`

Examples:
- `test_parseThread_smallThread_returnsCorrectNodeCount`
- `test_checkLimit_eleventhRequest_blocks`
- `test_sanitize_scriptTag_removesScript`

This convention makes test names self-documenting and grep-friendly. All test names in this document follow this format.
