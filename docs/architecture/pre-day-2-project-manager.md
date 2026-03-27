# Pre-Day 2 Architecture Decision: Project Manager

**Date:** 2026-03-27
**Role:** Senior Project Manager
**Decision:** Option 1 -- Client-side fetch

## Analysis

### Situation Summary

Day 1 benchmarks confirmed that Reddit returns 403 for all `.json` requests from Vercel IPs. The server-side fetch described in the build plan is dead on arrival. The processing pipeline itself is healthy: sanitize-html handles 500 comments in ~188ms, Redis round-trips are ~68ms total, and the full processing budget (excluding fetch) is ~257ms -- leaving 9.7 seconds of Vercel's 10-second timeout unused. The blocker is exclusively the fetch step.

Two options exist: (1) have the browser fetch Reddit and POST the raw JSON to our API for processing, or (2) introduce a proxy or secondary hosting service to perform the server-side fetch from non-Vercel IPs.

### Schedule Impact

**Option 1 (client-side fetch):** Requires changes to the API route contract (POST body instead of URL query parameter), a small client-side fetch utility, and adjustment of the DataSource implementation to split "fetch" from "process." The DataSource interface remains intact -- the boundary just moves. This is a half-day to one-day change, contained within the existing Week 1 schedule. The critical path (ThreadGraph.tsx in Week 2) is not affected.

**Option 2 (proxy/workaround):** Requires provisioning a new service (Cloudflare Worker, Railway, or AWS Lambda), writing and deploying a proxy function, handling authentication/CORS between the proxy and Vercel, monitoring an additional service, and debugging cross-service failures. Even with a simple implementation, this adds 1-2 days of work plus an ongoing operational surface. If the proxy also gets blocked by Reddit (which is plausible -- Reddit blocks many cloud IPs), the time is wasted and we fall back to Option 1 anyway.

**Verdict: Option 1 saves 1-2 days on the critical path.**

### Risk

**Option 1 risks:**
- Reddit CORS headers may not be present on `.json` responses. However, Reddit does set `Access-Control-Allow-Origin: *` on their `.json` endpoints for unauthenticated requests. This is well-documented in community usage. If CORS is ever restricted, we would need to revisit -- but that is the same "platform risk" the PRD already acknowledges.
- Larger client-side payload (raw Reddit JSON can be 1-5 MB for large threads). This is manageable: the 500-comment cap means we are processing at most a few MB, and modern browsers handle this without issue.
- The client becomes responsible for the initial fetch reliability. Network errors surface in the browser rather than in server logs. Mitigation: clear error states are already specified in the build plan (Section 5).

**Option 2 risks:**
- The proxy service itself may be blocked by Reddit. Reddit actively blocks cloud provider IP ranges. There is no guarantee a Cloudflare Worker or Railway IP fares better than Vercel. This is the single biggest risk: we could spend 2 days building infrastructure that hits the same wall.
- Introduces a new failure domain. Every request now traverses Vercel -> Proxy -> Reddit -> Proxy -> Vercel. Latency increases, debugging complexity increases, and there are twice as many network hops that can fail.
- Vendor lock-in to a second platform for a critical-path function.

**Verdict: Option 1 has fewer unknowns. Option 2's central risk (proxy also gets blocked) could waste the entire effort.**

### Budget

**Option 1:** $0/month. No new services. The browser does the fetch; Vercel does the processing. Stays within the Vercel Hobby + Upstash free tier constraint.

**Option 2:** A Cloudflare Worker free tier could technically work (100K requests/day), but adds operational cost in terms of a second deployment pipeline, a second set of environment variables, and a second service to monitor. Railway or AWS Lambda would add actual dollar costs. Even at small scale, this violates the $0/month constraint or requires justification for why a free proxy tier will remain sufficient.

**Verdict: Option 1 is the only option that cleanly meets the $0/month budget.**

### Acceptance Criteria Impact

Walking through all 10 ACs:

1. **Paste URL, graph renders within 5s/10s:** Both options can meet this. Option 1 adds the browser fetch time (~1-3s), but the benchmark shows processing is only ~257ms, so total stays well under 10s for uncached. Cached responses skip the fetch entirely (served from Redis via the API route).
2. **Nodes sized by score, colored by sentiment:** No impact. Processing happens server-side in both options.
3. **Pan/zoom smooth:** No impact. Visualization layer is unchanged.
4. **Click node, detail panel:** No impact.
5. **Depth slider and score filter:** No impact.
6. **Threads >500 comments, capped view:** No impact. Capping happens in the parser on the server.
7. **Same thread within 15 min, served from cache:** Works in both options. On cache hit, the API returns cached ThreadData without any Reddit fetch. The client-side fetch is only needed on cache miss.
8. **>10 req/min, 429 response:** No impact. Rate limiting is on the API route.
9. **Non-Reddit URLs, 400 response:** Slight change in Option 1. URL validation can still happen server-side (the client sends the URL along with the JSON, and the server validates the URL pattern before processing). Alternatively, validation happens client-side before the fetch. Either way, the AC is met.
10. **Keyboard-navigable controls:** No impact.

**Verdict: All 10 ACs are achievable with Option 1. No AC is compromised.**

### Scope

**Option 1:** Adds a small client-side fetch utility (~50 lines) and modifies the API route to accept POST with a JSON body instead of a URL query parameter. The DataSource interface splits into "fetch" (client) and "process" (server), but this is a clean separation that arguably improves the architecture. No new dependencies, no new services, no new deployment pipelines.

**Option 2:** Adds an entirely new service to the project scope: a proxy function that must be written, tested, deployed, monitored, and maintained. This is scope creep for a project that already has a tight 4-week timeline with 4 buffer days. Spending 1-2 of those buffer days on proxy infrastructure in Week 1 leaves less room for the ThreadGraph.tsx implementation (the actual hard part of this project, allocated a full 5 days in Week 2).

**Verdict: Option 1 adds minimal scope. Option 2 consumes buffer days that the project cannot afford to lose this early.**

### Reversibility

**Option 1 to server-side fetch:** If Reddit ever unblocks Vercel IPs (or we move to authenticated API access in a future phase), switching back to server-side fetch is straightforward. The API route already does all the processing. We just move the fetch call from the client into the route handler. The DataSource abstraction makes this a one-file change. Estimated effort: 2-4 hours.

**Option 2 to server-side fetch:** Requires decommissioning the proxy service, removing the cross-service communication, and collapsing the fetch back into the API route. More cleanup, but also reversible. Estimated effort: half a day plus cleanup.

**Verdict: Both are reversible, but Option 1 is simpler to reverse because there is no external service to decommission.**

### Team Morale and Momentum

This is end of Day 1. The team (solo developer) just completed a productive first day: 43 tests passing, all lib modules scaffolded, Vercel deployed, benchmarks run. The Reddit 403 is the first real setback.

**Option 1** keeps momentum. The fix is contained: adjust the API contract, write a small client fetch, and move on to the parser and DataSource implementation that were already planned for Days 2-3. The developer stays in the codebase they just built.

**Option 2** creates a detour. The developer leaves the Thread Cartographer codebase to set up a proxy on a different platform, debug cross-origin issues, and manage a second deployment. This is exactly the kind of yak-shaving that kills solo-project momentum in Week 1.

**Verdict: Option 1 preserves the Day 1 momentum. Option 2 risks a morale-killing detour.**

### Long-Term Considerations

The PRD already identifies "OAuth / authenticated Reddit requests" as a Phase 2 non-goal. When OAuth is eventually implemented, the fetch will likely move server-side (authenticated requests from Vercel may not be blocked, and OAuth enables higher rate limits). Option 1's architecture -- where the API route is already a processing pipeline that accepts thread data -- maps cleanly to this future state. The fetch source (browser vs. server vs. OAuth) becomes a pluggable concern.

Option 2's proxy would be throwaway infrastructure once OAuth is implemented, making it a dead-end investment.

## Verdict

**Option 1: Client-side fetch.** The browser fetches Reddit `.json`, then POSTs the raw JSON to our API route for processing.

The reasoning is decisive across every dimension:

1. **Schedule:** Saves 1-2 days vs. Option 2. Does not touch the critical path (ThreadGraph in Week 2).
2. **Risk:** Reddit CORS on `.json` is well-established. Option 2's central risk (proxy also blocked) could waste the entire effort.
3. **Budget:** $0/month, no new services. Option 2 introduces operational cost even on free tiers.
4. **Acceptance criteria:** All 10 ACs are achievable without modification.
5. **Scope:** Minimal addition (~50 lines of client fetch code). Option 2 adds an entire service.
6. **Reversibility:** One-file change to move fetch server-side if/when Reddit unblocks Vercel or OAuth is implemented.
7. **Momentum:** Keeps the developer in the codebase on Day 2 instead of setting up external infrastructure.
8. **Long-term:** Clean path to OAuth in Phase 2. Option 2's proxy becomes throwaway.

The only scenario where Option 2 would be preferable is if Reddit blocks browser-origin `.json` requests (CORS restriction). This is not currently the case and would break a large ecosystem of Reddit client apps. If it happens, we can reassess -- but building for a hypothetical future restriction at the cost of real schedule and budget today is not justified.

**Action items for Day 2:**
- Write DECISION-003 documenting this architecture change
- Implement a client-side Reddit fetch utility
- Modify `app/api/thread/route.ts` to accept POST with raw Reddit JSON body
- Adjust the DataSource implementation to reflect the fetch/process split
- Update the build plan's Week 1 schedule to reflect the new contract
