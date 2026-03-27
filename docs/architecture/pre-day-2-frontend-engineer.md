# Pre-Day 2 Architecture Decision: Frontend Engineer

**Date:** 2026-03-27
**Role:** Senior Frontend Engineer
**Decision:** Option 1 (Client-side fetch with server-side processing)

## Analysis

### The Problem

Reddit returns 403 for all `.json` requests originating from Vercel IPs. This was confirmed empirically on Day 1 -- both `/hot.json` and `/comments/*.json` fail consistently. The original architecture assumed server-side fetch. We need to adapt without blowing up the schedule.

### Option 1: Client-side fetch, server-side processing

The browser fetches `https://www.reddit.com/r/.../comments/.../.json` directly, then POSTs the raw JSON to our `/api/thread` route. The server parses, scores sentiment, sanitizes HTML, caches, and returns `ThreadData`.

### Option 2: Server-side with proxy/workaround

Use a CORS proxy, Cloudflare Worker, or other intermediary to fetch Reddit from a non-Vercel IP.

### Detailed Evaluation

#### 1. Impact on UX and Loading States

**Option 1:** Two-phase loading -- browser fetches Reddit JSON, then sends it to our API. The user sees a spinner for both phases. This is actually straightforward to implement well: a single `async` flow in the client that (a) fetches Reddit, (b) POSTs to our API. From the user's perspective it is one loading state, not two. The total wall-clock time is: Reddit fetch (1-3s from browser) + API processing (~257ms from benchmarks) + network round-trip (~100ms). Well within the 10s target for uncached requests.

Error handling is clean: if Reddit returns 403/404/5xx, we catch it client-side and show a specific error *before* ever hitting our API. This is actually *better* UX than a server-side fetch where the user waits for our server to time out on a Reddit failure.

**Option 2:** Single loading phase, but errors from the proxy are opaque. If Cloudflare Worker fails, or the CORS proxy throttles us, or Reddit blocks the proxy IP (which *will* happen eventually -- this is whack-a-mole), the user gets a generic server error. Debugging is harder. The UX for failures is worse.

**Edge:** Option 1.

#### 2. CORS Considerations

Reddit's `.json` endpoint does NOT set restrictive CORS headers for GET requests from browsers -- it is a public JSON endpoint that browsers can fetch directly. This is how every Reddit client-side app (old.reddit.com, third-party extensions) works. No CORS issue exists for Option 1.

Option 2 introduces CORS complexity: our proxy needs to set `Access-Control-Allow-Origin` headers, handle preflight for any custom headers, etc. More moving parts.

**Edge:** Option 1.

#### 3. Bundle Size and Payload

Large Reddit threads can produce 1-2MB of raw JSON. With Option 1, this payload travels: Reddit -> browser -> our API (as POST body). That is one extra network hop for the raw data compared to server-side fetch.

However:
- The browser already has to *receive* the processed `ThreadData` from our API anyway (which is roughly the same size minus the Reddit metadata bloat).
- The POST upload of 1-2MB on modern connections takes <1 second.
- We are NOT adding the Reddit JSON to the client bundle. It is fetched at runtime.
- The Vercel Hobby plan has a 4.5MB request body limit, which accommodates even very large threads.

For threads above the 500-comment cap, the client could potentially send a lot of data that the server will mostly discard. A minor optimization: the client could pre-truncate to reduce upload size, but this is premature -- the 1-2MB range is fine for a POST.

**Edge:** Neutral. Neither option avoids the data transfer cost; they just differ in who fetches from Reddit.

#### 4. Impact on the DataSource Abstraction

This is the key architectural question. The current `DataSource` interface is:

```typescript
interface DataSource {
  fetchThread(url: string): Promise<ThreadData>;
  isValidUrl(url: string): boolean;
}
```

**Option 1:** The `DataSource` abstraction survives cleanly. We split it into two concerns:
- A client-side `RedditFetcher` that takes a URL and returns raw JSON.
- A server-side `RedditJsonDataSource` that takes raw JSON (not a URL) and returns `ThreadData`.

The API route signature changes from `GET /api/thread?url=...` to `POST /api/thread` with `{ url, rawJson }` in the body. The `DataSource` interface on the server side can be adapted to accept pre-fetched data:

```typescript
// New server-side interface
interface DataSource {
  processThread(url: string, rawJson: unknown): Promise<ThreadData>;
  isValidUrl(url: string): boolean;
}
```

Or more conservatively, we keep `fetchThread(url)` and add a `processRawJson(url, data)` method. Either way, the abstraction holds. The parser, sentiment scorer, sanitizer, and cacher all work identically -- they do not care where the JSON came from.

**Option 2:** The `DataSource` abstraction stays as-is, but now it depends on a third-party proxy. The proxy itself becomes an implicit part of the data source layer that is not captured in our abstraction. If the proxy goes down, our entire pipeline fails, and the `DataSource` interface gives us no way to swap in a fallback.

**Edge:** Option 1. The abstraction is actually *cleaner* because the fetch and processing concerns are explicitly separated.

#### 5. Impact on Caching Strategy

**Option 1:** Caching works identically to the original plan. The server receives the raw JSON, processes it, caches the `ThreadData` in Redis keyed by normalized URL, and returns it. On subsequent requests for the same URL, the server checks the cache first (before requiring the client to upload anything).

The flow becomes:
1. Client sends `POST /api/thread` with `{ url }` (no rawJson yet).
2. Server checks cache. If HIT, returns immediately.
3. If MISS, server returns a `{ status: "FETCH_REQUIRED" }` response.
4. Client fetches Reddit JSON, sends `POST /api/thread` with `{ url, rawJson }`.
5. Server processes, caches, returns.

Alternatively, and more simply: the client always sends the URL first as a lightweight check, and only fetches+uploads on cache miss. This avoids uploading 1-2MB when we have a cache hit.

Actually, the simplest approach: the client always sends `POST { url, rawJson }`. The server checks cache first, and if HIT, ignores the rawJson and returns cached data. The wasted upload on cache hits is a minor inefficiency, but it simplifies the client code enormously. Given the 15-minute TTL and expected usage patterns, most requests will be cache misses anyway (different URLs).

**Option 2:** Caching works the same, but we are caching data that flowed through a proxy we do not control.

**Edge:** Option 1, slightly, because the two-phase approach gives us an optimization path for cache hits.

#### 6. Security Considerations

**Option 1:** The server receives raw JSON from the client. This is the one area that needs care:
- The server MUST NOT trust the client-supplied JSON blindly. It must validate the structure matches Reddit's expected format.
- The server already sanitizes all HTML via sanitize-html, so XSS via malicious `body_html` is handled.
- The `url` parameter must still pass allowlist validation (only `reddit.com/r/*/comments/*`).
- A malicious client could send fabricated JSON. Since we are a visualization tool (not a social platform), the impact is limited -- they would see a fabricated graph of their own data. There is no user-generated content visible to *other* users.
- Rate limiting still applies per-IP on the POST endpoint, preventing abuse.
- Request body size should be capped (e.g., 5MB) to prevent memory exhaustion.

**Option 2:** A CORS proxy or Cloudflare Worker that fetches arbitrary URLs is an open relay risk. Even with URL allowlisting, it is a more attractive attack surface than Option 1. The proxy itself needs security hardening, rate limiting, and monitoring -- a second system to maintain.

**Edge:** Option 1. The attack surface is smaller and more contained.

#### 7. Impact on ThreadGraph and Web Worker Architecture

**Zero impact for either option.** The ThreadGraph component and Web Worker consume `ThreadData`, which is produced by the server regardless of how the raw JSON was obtained. The visualization pipeline is completely decoupled from the data fetching mechanism.

#### 8. Schedule Impact

**Option 1:** Minimal schedule impact. The changes are:
- Add a `fetch` call in the client-side code (UrlInput or a small hook) to fetch Reddit JSON.
- Modify `/api/thread/route.ts` from GET to POST, accepting `rawJson` in the body.
- Add JSON structure validation in the API route.
- `redditParser.ts` and everything downstream remain unchanged.

Estimated additional work: 2-4 hours. This is Day 2 work that replaces the planned `redditFetch.ts` server-side implementation, so it is not additive -- it is a pivot of the same effort.

**Option 2:** Significant schedule impact:
- Stand up and configure a Cloudflare Worker or find/vet a CORS proxy.
- Add a new deployment target (Cloudflare account, wrangler config, CI/CD).
- Handle proxy-specific error codes and timeouts.
- Monitor for Reddit blocking the proxy IPs (ongoing operational burden).
- Estimated additional work: 1-2 days, plus ongoing maintenance risk.

**Edge:** Option 1, decisively. We are in Week 1 of a 4-week timeline with no slack.

#### 9. Resilience and Long-term Viability

Reddit blocks Vercel IPs today. They could block Cloudflare Worker IPs tomorrow. They could block specific CORS proxies next week. Option 2 is a game of whack-a-mole against Reddit's anti-bot measures.

Option 1 is immune to server-side IP blocking because the fetch happens from the user's browser -- the same way millions of people access Reddit every day. Reddit cannot block browser requests to their own `.json` endpoints without breaking their own site's functionality.

If Reddit ever restricts the `.json` endpoint entirely (requiring OAuth), both options fail equally, and we would need to implement OAuth -- which is explicitly a Phase 1 non-goal.

**Edge:** Option 1, strongly.

## Verdict

**Option 1: Client-side fetch with server-side processing.**

The reasoning is clear on every axis:

1. **UX is better** -- faster error feedback, simpler loading states.
2. **No CORS issues** -- Reddit `.json` is browser-fetchable.
3. **DataSource abstraction is cleaner** -- explicit separation of fetch and process.
4. **Caching works identically** -- with an optimization path for cache hits.
5. **Security surface is smaller** -- no open relay, no proxy to harden.
6. **Zero impact on visualization pipeline** -- ThreadGraph and Worker are unchanged.
7. **Schedule impact is minimal** -- 2-4 hours of pivot work vs 1-2 days for a proxy.
8. **Long-term resilience** -- immune to server-side IP blocking.

The only downside is that cache hits still require a POST from the client (or a two-phase check), and cache-miss requests upload 1-2MB of raw JSON. Both are trivially manageable.

Implementation recommendation for Day 2:
1. Modify `DataSource` to accept pre-fetched data: add `processThread(url: string, rawJson: unknown): Promise<ThreadData>`.
2. Implement a lightweight JSON schema validator for the Reddit response structure.
3. Change `/api/thread` from GET to POST. Accept `{ url: string, rawJson?: unknown }`. If `rawJson` is absent, check cache only and return HIT or `FETCH_REQUIRED`. If present, process and cache.
4. Write a `useRedditFetch` hook (or utility in `lib/redditFetch.ts` as a client module) that orchestrates: check cache -> fetch Reddit if needed -> POST raw JSON -> return `ThreadData`.
5. Cap request body at 5MB in `vercel.json` or the route handler.
