# Pre-Day 2 Architecture Decision: Backend Engineer

**Date:** 2026-03-27
**Role:** Senior Backend Engineer
**Decision:** Option 1 — Client-side fetch with server-side processing

## Analysis

### 1. The Hard Constraint

Reddit returns 403 for all `.json` requests from Vercel IPs. This was confirmed in the Day 1 benchmark. This is not a configuration issue or a transient failure — Reddit actively blocks known cloud provider IP ranges. This constraint eliminates the original architecture where the server fetches Reddit data directly.

### 2. Option 2 Evaluation: Server-Side Proxy/Workaround

Before endorsing Option 1, I need to explain why Option 2 is a trap.

**Cloudflare Worker as proxy:** This works technically. A Worker on a different IP range fetches Reddit, returns the JSON to our Vercel function. But consider what we are actually building: a second service, with its own deployment pipeline, its own failure modes, its own rate limiting concerns, its own monitoring. We are in Week 1 of a 4-week solo-developer timeline. The operational complexity is not justified.

Specific problems:
- **Two services to maintain.** The Cloudflare Worker needs its own repo or deploy config, its own environment variables, its own error handling. When it goes down, our entire app is dead and the failure mode is opaque — the user sees a generic 502 from Vercel, not a clear "Reddit is unavailable" message.
- **Latency penalty.** Client -> Vercel -> Cloudflare Worker -> Reddit -> Cloudflare Worker -> Vercel -> Client. Every hop adds latency. For a large thread (1-2MB JSON), this double-proxying is wasteful. We are paying transfer costs twice for data that the browser could fetch directly.
- **Rate limiting complexity.** We would need to rate-limit the Worker separately from the API route. The Worker becomes an open relay for Reddit data unless we authenticate requests from our Vercel backend to the Worker, which means shared secrets, CORS configuration, and more moving parts.
- **Reddit could block Workers too.** If Reddit is already blocking Vercel IPs, Cloudflare Workers IPs (which are also well-known cloud ranges) could be next. We would be building on another potentially unstable foundation.
- **Schedule impact.** Conservatively 1-2 days to set up, test, and harden a Cloudflare Worker proxy. That is 6-12% of our total effective coding time, spent on infrastructure that adds no user-visible value.

**CORS proxy services (e.g., cors-anywhere):** Absolutely not. Third-party CORS proxies are unreliable, rate-limited themselves, and a security liability. We would be routing Reddit data through an untrusted third party.

**Alternative hosting for the fetch function (e.g., Railway, Fly.io):** Same problems as Cloudflare Worker — second service, second deploy target, second failure domain — with even more operational overhead.

### 3. Option 1 Evaluation: Client-Side Fetch

The browser fetches Reddit `.json` directly (browsers are not blocked by Reddit's IP filtering — Reddit serves `.json` to browsers with appropriate CORS headers or same-origin context). The client then POSTs the raw JSON to our API route for processing.

This is the right call. Here is why, and here are the risks.

#### 3a. Impact on DataSource Abstraction

The `DataSource` interface (`fetchThread(url): Promise<ThreadData>`) was designed to run server-side. With client-side fetch, the interface semantics change:

- **Server-side `DataSource` still exists**, but its implementation changes. `RedditJsonDataSource.fetchThread()` no longer fetches from Reddit. Instead, it receives pre-fetched raw JSON and processes it (parse, score sentiment, sanitize, build graph). The method signature could become `processThread(rawJson: unknown): ThreadData` or we keep `fetchThread` but the "fetch" is from the request body, not from Reddit.
- **Recommended approach:** Split the current planned `RedditJsonDataSource` into two concerns:
  1. `RedditJsonParser` — a pure function: `(rawJson: unknown) => ThreadData`. Handles parsing, validation, sentiment scoring, sanitization, 500-cap logic. This is testable, stateless, and reusable.
  2. `RedditJsonDataSource` still implements `DataSource`, but its `fetchThread()` method is only used in contexts where server-side fetch works (local dev, alternative hosting). For the Vercel production path, the API route calls `RedditJsonParser` directly with the client-provided JSON.
- **The abstraction survives.** The `DataSource` interface remains valid for future use (e.g., if we move to OAuth with Reddit's official API, or if we add a different hosting backend). We just do not use it on the critical path in production.

#### 3b. API Route Design: POST with Raw JSON Body

The route changes from:
```
GET /api/thread?url=https://reddit.com/r/.../comments/abc123
```
to:
```
POST /api/thread
Content-Type: application/json
Body: { "url": "https://...", "redditData": <raw Reddit JSON> }
```

This is the correct design. Reasons:
- GET with a URL param implies the server fetches the resource. POST with a body accurately represents "here is data, process it for me."
- The raw Reddit JSON for a 500-comment thread can be 1-2MB. GET request URLs have practical limits (~2KB in many proxies). The data must go in a request body.
- **Vercel Hobby body limit is 4.5MB.** Reddit threads with 500 comments typically produce 1-2MB of JSON. This fits comfortably. Threads that exceed 4.5MB would already exceed our 500-comment cap, so the client should apply the cap before sending. This is an important implementation detail: the client must do a preliminary parse to count comments and apply the 500-cap before POSTing.

Wait — that last point deserves more scrutiny. If the client is doing a preliminary parse to apply the 500-cap, we are pushing processing logic to the client. This is a slippery slope. **Better approach:** the client sends the raw JSON as-is (up to 4.5MB). The server applies the 500-cap during parsing. If a Reddit response exceeds 4.5MB raw, the client truncates at the byte level before sending and sets a flag, or we return a 413 with a clear message. In practice, the Reddit `.json` endpoint itself caps at ~1000 items, so raw responses rarely exceed 3MB. The 4.5MB limit is sufficient.

#### 3c. Request Size and the 4.5MB Limit

- Typical 500-comment thread: 800KB - 1.5MB raw JSON
- Large thread (1000 items, Reddit's own cap): 2-3MB raw JSON
- The 4.5MB Vercel Hobby limit provides adequate headroom
- **Mitigation:** If the client receives a response larger than 4MB from Reddit, it should not POST it. Show a client-side error: "This thread is too large to process. Try a thread with fewer comments." This is a client-side guard, not a server-side one.

#### 3d. Rate Limiting Strategy

This is the most significant architectural change. In the original design, the server rate-limits both API requests AND Reddit fetches. With client-side fetch:

- **Server rate limiting still works for our API.** The `POST /api/thread` endpoint is still rate-limited at 10 req/min per IP via Upstash Redis. This protects our server resources (CPU for parsing/sanitization, Redis for caching).
- **We cannot rate-limit Reddit fetches.** The client fetches Reddit directly. A malicious client could hammer Reddit from our UI. However: this is Reddit's problem, not ours. Reddit has its own rate limiting. Our UI is just a browser making a fetch — the same as if the user opened the `.json` URL in a new tab. We are not acting as a proxy, so we are not amplifying abuse.
- **The `X-Ratelimit-Remaining` header awareness planned for `redditFetch.ts` is no longer relevant on the server side.** The client could read these headers from Reddit's response, but CORS restrictions may prevent access to Reddit's rate limit headers. In practice, we should drop this feature — the client will see Reddit's own 429 responses if it fetches too aggressively, and our server-side 10 req/min limit prevents abuse of our processing pipeline.

#### 3e. Cache Key Design and Invalidation

**No change needed.** The cache key is the thread ID extracted from the URL (already implemented in `cache.ts` via `extractThreadId()`). The flow becomes:

1. Client sends `POST /api/thread` with `{ url, redditData }`
2. Server extracts thread ID from URL
3. Server checks cache by thread ID
4. **Cache HIT:** Return cached `ThreadData` immediately. Ignore the `redditData` payload.
5. **Cache MISS:** Parse `redditData`, score sentiment, sanitize HTML, build `ThreadData`, cache it, return it.

This means the client sends the Reddit JSON even on cache hits. This is wasteful but simple. Optimization: add a two-phase flow:
1. `GET /api/thread/status?url=...` — returns `{ cached: true/false }`
2. If not cached, client fetches Reddit and POSTs

This adds a round trip but avoids uploading 1MB+ on cache hits. **My recommendation: skip the optimization for Phase 1.** The simplicity of a single POST request outweighs the bandwidth cost. Users with slow upload speeds are the edge case, and the Reddit JSON is typically well-compressed by the browser's Accept-Encoding. Revisit if telemetry shows cache-hit uploads are a real performance problem.

Actually, I want to revise this. The two-phase approach is better than I initially gave it credit for. Consider: 70%+ of requests should be cache hits (per the success metrics table). Uploading 1MB of JSON for 70% of requests only to throw it away is genuinely wasteful, and it penalizes the user experience on the happy path. **Revised recommendation:** Implement the two-phase flow. It is one additional endpoint (trivial) and meaningfully improves the common case.

Phase 1 flow:
1. `GET /api/thread?url=...` — checks cache, returns `ThreadData` if cached (with `X-Cache: HIT`)
2. If 404 (cache miss), client fetches Reddit `.json`, then `POST /api/thread` with `{ url, redditData }`
3. Server parses, caches, returns `ThreadData` (with `X-Cache: MISS`)

This preserves the original GET endpoint for cache hits and adds POST for the processing path. Both are rate-limited. Clean.

#### 3f. Security: Arbitrary JSON from Client

This is the most serious concern. The server now receives untrusted JSON that claims to be a Reddit response. Attack vectors:

1. **Malformed JSON / unexpected structure.** Mitigation: strict schema validation. The Reddit `.json` response has a well-defined structure (`Listing` with `kind: "t3"` for posts, `kind: "t1"` for comments, `kind: "more"` for stubs). The parser must validate this structure and reject anything that does not conform. Use a validation function that checks `kind` fields, required properties (`author`, `body`, `score`, `created_utc`), and type-checks values. Do not use `zod` or similar heavyweight validators — a focused manual validation function is sufficient and avoids a new dependency.

2. **XSS via injected HTML.** Mitigation: `sanitize-html` already runs on `body_html` server-side. This does not change. Even if an attacker crafts a fake Reddit response with malicious HTML in `body_html`, the sanitizer strips it. This is defense-in-depth that was already planned.

3. **Fake thread data (fabricated comments, altered scores).** This is a philosophical concern more than a security one. Someone could POST a crafted Reddit-like JSON with fake comments. The server would process it, cache it, and return it. Subsequent users requesting the same thread ID would get the fake data from cache. **Mitigation:** Do not cache based solely on the URL the client claims. Extract the thread ID from the URL, but also validate that the Reddit JSON's `permalink` or `id` field matches the claimed thread ID. If they do not match, reject with 400. This prevents cache poisoning — an attacker cannot inject data for thread X by claiming the URL is thread Y.

4. **Denial of service via large payloads.** Mitigation: Vercel's 4.5MB limit is the first guard. The parser should also bail early if it encounters more than, say, 5000 items in the listing (well above our 500-cap but below absurd sizes). Set a max parse depth to prevent deeply nested JSON bombs.

5. **Cache poisoning via race condition.** If two clients POST different data for the same thread ID simultaneously, one wins. This is fine — both are presumably valid Reddit responses from slightly different moments. The 15-min TTL ensures stale data does not persist.

#### 3g. Open-Relay Risk

**Client-side fetch eliminates the open-relay concern entirely.** In the original design, the server fetched arbitrary URLs, making it a potential open relay (attacker sends `url=https://evil.com/sensitive-data`, server fetches it). With client-side fetch, the server never makes outbound HTTP requests to Reddit (or anywhere else based on user input). The server only receives and processes data. The URL allowlisting is still valuable for cache key validation, but the open-relay attack surface is gone.

This is a genuine security improvement over the original architecture.

#### 3h. Impact on `X-Ratelimit-Remaining` Awareness

The build plan specifies that `redditFetch.ts` should read Reddit's `X-Ratelimit-Remaining` response headers and back off when approaching the limit. With client-side fetch:

- The browser makes the Reddit request, not the server.
- Reddit's rate limit headers may not be accessible to JavaScript due to CORS (Reddit would need to include them in `Access-Control-Expose-Headers`).
- Even if accessible, the rate limit is per-IP, and each user has their own IP. There is no shared rate limit to manage.
- **Verdict:** Drop `X-Ratelimit-Remaining` awareness entirely. It was designed for a server that makes many Reddit requests from a single IP. With client-side fetch, each user is rate-limited individually by Reddit, and our server never talks to Reddit at all.

#### 3i. CORS Considerations for Client-Side Reddit Fetch

One critical question: does Reddit's `.json` endpoint support CORS for browser requests? Reddit does set CORS headers on their `.json` endpoints — `Access-Control-Allow-Origin: *` is present on public subreddit and thread JSON responses. If this were not the case, client-side fetch would be impossible and we would be forced into Option 2. This needs verification on Day 2 — a simple browser console `fetch('https://www.reddit.com/r/.../.json')` test confirms it. If Reddit does not allow CORS, we must fall back to Option 2 with a lightweight proxy. **This is the single biggest risk in Option 1.**

Fallback plan if CORS fails: use `old.reddit.com` which has different CORS behavior, or use a minimal Cloudflare Worker as a thin CORS proxy (not a full processing proxy). This would be a narrow, well-scoped proxy that adds CORS headers and nothing else — much simpler than the full Option 2.

#### 3j. Schedule Impact

Option 1 is faster to implement than Option 2:

- **No new infrastructure.** No Cloudflare Worker, no second deploy target, no shared secrets.
- **Parser and processing pipeline are unchanged.** The same `redditParser.ts` logic applies — it just receives its input from the request body instead of from a fetch call.
- **API route is slightly more complex** (POST handler, JSON validation, cache-check GET endpoint), but this is a few hours of work, not days.
- **Client-side fetch logic** is straightforward — `fetch(url + '.json')` and POST the result.
- **Estimated schedule impact:** Half a day to adjust the API route design and add JSON validation. Net savings of 1-1.5 days compared to Option 2 (no proxy infrastructure).

### 4. Implementation Recommendations

If Option 1 is adopted, here are the specific implementation changes:

1. **`lib/redditFetch.ts`** — Rename or repurpose. This module was planned to fetch from Reddit server-side. It should become a client-side utility (`lib/client/redditFetch.ts`) or be eliminated in favor of a simple `fetch` call in the React component. The User-Agent header (`ThreadCartographer/1.0`) cannot be set from the browser (browsers override User-Agent), so drop that requirement.

2. **`lib/redditParser.ts`** — No change in purpose. It receives raw Reddit JSON and produces `CommentNode[]` + `ThreadEdge[]`. Add input validation at the top: verify the JSON has the expected Reddit listing structure before attempting to parse.

3. **`lib/redditJsonDataSource.ts`** — Keep the interface but add a `processRawJson(url: string, rawJson: unknown): Promise<ThreadData>` method. The `fetchThread()` method can delegate to this after fetching (useful for local dev and testing), while the API route calls `processRawJson()` directly.

4. **`app/api/thread/route.ts`** — Implement both GET (cache check) and POST (process + cache) handlers. GET takes `?url=` param, returns cached data or 404. POST takes `{ url, redditData }` body, validates, processes, caches, returns `ThreadData`.

5. **Input validation** — Add a `lib/validateRedditJson.ts` module that checks the structural integrity of the raw Reddit JSON before parsing. This is the primary defense against malicious input.

6. **Drop `X-Ratelimit-Remaining` awareness** from the server-side code. It is no longer applicable.

7. **Verify CORS on Day 2 morning** before writing any client-side fetch code. This is a go/no-go gate for Option 1.

## Verdict

**Option 1: Client-side fetch with server-side processing.**

The reasoning is straightforward:

1. **It works.** The browser can fetch Reddit `.json` (pending CORS verification). The server processes it. The architecture is simple.
2. **It is faster to build.** No second service, no proxy infrastructure, no shared secrets. We save 1-1.5 days on a tight 4-week schedule.
3. **It is more secure in one important way.** The open-relay attack surface disappears entirely. The server never makes outbound requests based on user input.
4. **The new security concern (untrusted client JSON) is manageable.** Schema validation, sanitization, and cache-key verification address the main attack vectors. These are well-understood mitigations.
5. **The DataSource abstraction survives.** We add a `processRawJson()` method alongside `fetchThread()`. The interface remains useful for testing and future architecture changes.
6. **The cache design is unchanged.** Same keys, same TTL, same Redis infrastructure.
7. **The main risk (CORS) is verifiable in 5 minutes.** If CORS fails, we fall back to a minimal CORS-only proxy, which is far simpler than a full Option 2 proxy.

The one thing I want to be explicit about: Option 1 means we are trusting the client to provide authentic Reddit data. A determined attacker could send fabricated thread data. For a visualization tool with no user accounts and no stored state, this is an acceptable risk — the attacker only poisons their own cache entry for 15 minutes, and the data is publicly visible Reddit content anyway. If Thread Cartographer ever evolves to store data permanently or serve it to other users beyond the cache window, this trust model would need revisiting.
