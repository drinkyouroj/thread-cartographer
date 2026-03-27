# BUILD PLAN: Reddit Domain Expertise for Thread Cartographer

**Date:** 2026-03-26
**Purpose:** Reddit-specific domain knowledge that prevents engineers from building something that looks correct but fundamentally misunderstands the platform.

---

## 1. Reddit .json Response Anatomy

When you append `.json` to any Reddit thread URL, you get back a JSON array with exactly **two elements**:

```
[
  { "kind": "Listing", "data": { "children": [ ... ] } },   // Element 0: the POST
  { "kind": "Listing", "data": { "children": [ ... ] } }    // Element 1: the COMMENTS
]
```

### Element 0 -- The Post (t3)

The first Listing contains exactly one child, the post itself:

```json
{
  "kind": "Listing",
  "data": {
    "after": null,
    "children": [
      {
        "kind": "t3",
        "data": {
          "id": "abc123",
          "name": "t3_abc123",
          "title": "The post title",
          "author": "username",
          "selftext": "Raw markdown body (empty for link posts)",
          "selftext_html": "&lt;!-- SC_OFF --&gt;&lt;div class=\"md\"&gt;...&lt;/div&gt;",
          "score": 12453,
          "upvote_ratio": 0.94,
          "num_comments": 847,
          "subreddit": "AskReddit",
          "subreddit_name_prefixed": "r/AskReddit",
          "permalink": "/r/AskReddit/comments/abc123/the_post_title/",
          "url": "https://www.reddit.com/r/AskReddit/comments/abc123/the_post_title/",
          "created_utc": 1679500000.0,
          "is_self": true,
          "over_18": false,
          "locked": false,
          "archived": false,
          "stickied": false,
          "spoiler": false,
          "link_flair_text": "Serious Replies Only",
          "link_flair_richtext": [],
          "author_flair_text": "Verified",
          "crosspost_parent": "t3_xyz789",
          "crosspost_parent_list": [ { ... full parent post data ... } ],
          "distinguished": null,
          "edited": false,
          "gilded": 0,
          "all_awardings": [ ... ],
          "total_awards_received": 5,
          "contest_mode": false,
          "suggested_sort": "confidence"
        }
      }
    ]
  }
}
```

**Critical fields engineers miss:**

- `name` vs `id`: The `name` is the full "thing" identifier with type prefix (`t3_abc123`), while `id` is just `abc123`. Parent references in comments use the `name` format. **You must handle both.**
- `num_comments`: This is Reddit's count of ALL comments, including deleted ones. It will almost always be higher than the number of comment objects you actually receive in the JSON.
- `selftext_html`: HTML-encoded HTML. You must decode the HTML entities first (`&lt;` -> `<`), then sanitize. Double-encoding is a common trap.
- `upvote_ratio`: A float from 0.0 to 1.0. Reddit fuzzes vote counts, so `score` is approximate. `upvote_ratio` gives you a sense of controversy that raw score hides.
- `edited`: Either `false` or a **Unix timestamp** (float) of when it was last edited. Not a boolean despite looking like one.
- `distinguished`: `null` for normal posts, `"moderator"` for mod-distinguished, `"admin"` for admin-distinguished.
- `suggested_sort`: May be `null`, `"confidence"`, `"top"`, `"new"`, `"controversial"`, `"old"`, `"qa"`, or `"live"`. This is set by the subreddit or mod and affects default comment ordering.

### Element 1 -- The Comment Tree (t1 objects)

The second Listing contains comment objects nested via `replies`:

```json
{
  "kind": "Listing",
  "data": {
    "children": [
      {
        "kind": "t1",
        "data": {
          "id": "def456",
          "name": "t1_def456",
          "author": "commenter1",
          "body": "This is **markdown** with [links](https://example.com)",
          "body_html": "&lt;div class=\"md\"&gt;&lt;p&gt;This is &lt;strong&gt;markdown&lt;/strong&gt;...&lt;/div&gt;",
          "score": 234,
          "ups": 234,
          "downs": 0,
          "controversiality": 0,
          "depth": 0,
          "parent_id": "t3_abc123",
          "link_id": "t3_abc123",
          "permalink": "/r/AskReddit/comments/abc123/the_post_title/def456/",
          "created_utc": 1679501000.0,
          "edited": false,
          "distinguished": null,
          "stickied": false,
          "is_submitter": false,
          "author_flair_text": null,
          "score_hidden": false,
          "collapsed": false,
          "locked": false,
          "gilded": 0,
          "all_awardings": [],
          "replies": {
            "kind": "Listing",
            "data": {
              "children": [
                { "kind": "t1", "data": { ... nested reply ... } },
                { "kind": "more", "data": { ... } }
              ]
            }
          }
        }
      },
      {
        "kind": "more",
        "data": {
          "id": "_",
          "name": "t1__",
          "count": 342,
          "depth": 0,
          "parent_id": "t3_abc123",
          "children": ["ghi789", "jkl012", "mno345"]
        }
      }
    ]
  }
}
```

**Critical fields engineers miss on comments:**

- `parent_id`: Uses the `name` format with type prefix. A top-level comment has `parent_id` = `"t3_abc123"` (the post). A reply has `parent_id` = `"t1_def456"` (another comment). **Your edge-building logic must strip the `t1_` / `t3_` prefix to match node IDs, or use full names consistently. Pick one convention and stick with it.**
- `link_id`: Always points to the post (`t3_*`). Every comment in a thread has the same `link_id`. Useful for validation.
- `replies`: Can be either a Listing object (with nested children) OR an **empty string** `""`. Not null, not undefined -- an empty string. This will crash your parser if you blindly access `.data.children` on it.
- `depth`: 0-indexed. Top-level comments are depth 0. First reply is depth 1. This is reliable and provided by Reddit.
- `score_hidden`: When true, `score` is returned as `1` regardless of actual score. New comments in many subreddits hide scores for 1-24 hours.
- `controversiality`: Either `0` or `1`. Binary flag, not a scale. Set to 1 when upvote/downvote ratio is close to 50/50.
- `is_submitter`: True if this commenter is the original poster (OP). Useful for AMA visualization where OP responses are the interesting ones.
- `downs`: Always 0 in the public API. Reddit stopped exposing real downvote counts years ago. Do not use this field.
- `collapsed`: True if Reddit's crowd control or similar feature collapsed this comment. The comment data is still present.

### The "more" Object -- Truncation Markers

This is the single most important structure to handle correctly:

```json
{
  "kind": "more",
  "data": {
    "id": "_",
    "name": "t1__",
    "count": 342,
    "depth": 0,
    "parent_id": "t3_abc123",
    "children": ["ghi789", "jkl012", "mno345", ...]
  }
}
```

**Key behaviors:**

- `count`: How many total comments are hidden behind this "more" marker. Can be 0 (yes, zero -- Reddit sometimes emits "more" objects with `count: 0` and an empty `children` array).
- `children`: Array of comment IDs (without `t1_` prefix) that are the immediate next-level comments. These are the IDs you would pass to `/api/morechildren` if you were fetching them (we are not in Phase 1).
- **Two types of "more":**
  1. **Normal "more"**: Has a list of children IDs and a nonzero count. Appears when Reddit truncates breadth (too many siblings at one level).
  2. **"Continue this thread" more**: Has `id: "_"`, `count: 0`, and an empty `children: []`. Appears when Reddit truncates depth (thread is too deep). The `depth` field tells you where the cutoff happened.
- "more" objects can appear at ANY level of nesting -- as siblings of top-level comments, or deep inside a reply chain.

For Thread Cartographer, each "more" object becomes a stub node in the graph:
- Set `isStub: true`
- Set `childCount` to the `count` value
- Set `parentId` from the `parent_id` field (strip prefix)
- Use a synthetic ID like `more_${parent_id}_${depth}` since the `id` field is often `"_"`

---

## 2. URL Patterns and Edge Cases

### All Valid Reddit Thread URL Formats

Engineers need to handle all of these:

```
# Standard formats
https://www.reddit.com/r/subreddit/comments/abc123/post_title/
https://www.reddit.com/r/subreddit/comments/abc123/post_title
https://www.reddit.com/r/subreddit/comments/abc123/
https://www.reddit.com/r/subreddit/comments/abc123

# Deep-linked to a specific comment
https://www.reddit.com/r/subreddit/comments/abc123/post_title/def456/
https://www.reddit.com/r/subreddit/comments/abc123/post_title/def456

# Old Reddit
https://old.reddit.com/r/subreddit/comments/abc123/post_title/

# New Reddit (sh.reddit.com was used briefly)
https://new.reddit.com/r/subreddit/comments/abc123/post_title/
https://sh.reddit.com/r/subreddit/comments/abc123/post_title/

# Mobile
https://m.reddit.com/r/subreddit/comments/abc123/post_title/

# Short share links (these REDIRECT, they don't work with .json directly)
https://redd.it/abc123

# With query parameters
https://www.reddit.com/r/subreddit/comments/abc123/post_title/?sort=controversial
https://www.reddit.com/r/subreddit/comments/abc123/post_title/?sort=new&context=3
https://www.reddit.com/r/subreddit/comments/abc123/post_title/?utm_source=share&utm_medium=web

# Without https
http://www.reddit.com/r/subreddit/comments/abc123/post_title/
http://reddit.com/r/subreddit/comments/abc123/post_title/

# No www
https://reddit.com/r/subreddit/comments/abc123/post_title/

# Already has .json
https://www.reddit.com/r/subreddit/comments/abc123/post_title/.json
https://www.reddit.com/r/subreddit/comments/abc123/post_title.json

# Trailing slashes, mixed case subreddit
https://www.reddit.com/r/AskReddit/comments/abc123/POST_TITLE///
```

### Normalization Strategy

Convert all URLs to canonical form before cache lookup or fetching:

```
https://www.reddit.com/r/{subreddit}/comments/{post_id}/{slug}/.json
```

Implementation steps:
1. Parse the URL, stripping protocol scheme differences
2. Replace `old.reddit.com`, `new.reddit.com`, `m.reddit.com`, `sh.reddit.com`, `reddit.com` with `www.reddit.com`
3. Extract the post ID (`abc123` in the examples). This is the ONLY required unique identifier.
4. Strip query parameters entirely (they affect comment sort order but we want the default response)
5. Strip any deep-linked comment ID from the path (the `/def456/` at the end)
6. Remove `.json` if already present
7. Normalize trailing slashes
8. Append `.json`

**Important edge case:** If a user pastes a comment permalink (with the `/def456/` comment ID), the `.json` response will be scoped to that comment's subtree, not the full thread. You MUST strip the comment ID to get the whole thread. The comment ID is distinguishable from the post ID by its position -- it comes after the slug.

**Short links (`redd.it/abc123`):** These require an HTTP redirect follow to resolve to the full URL. Either reject them with a helpful error message, or follow the redirect before normalization. For Phase 1, rejecting with a message like "Please use the full Reddit thread URL" is acceptable.

### Query Parameters That Matter

While we strip query params for caching, engineers should know what they do:

- `?sort=confidence|top|new|controversial|old|qa` -- changes comment ordering in the response
- `?context=N` -- when deep-linking to a comment, includes N parent comments for context
- `?limit=N` -- limits how many comments Reddit returns (default varies, usually around 200)
- `?depth=N` -- limits nesting depth in the response
- `?showmore=false` -- suppresses "more" objects (rarely used)

For Phase 1, we want the default response (no params), which gives us Reddit's default sort (usually "confidence" aka "best") with default depth and limits.

---

## 3. Comment Tree Quirks

### How Reddit Truncates

Reddit applies two independent truncation strategies to the comment tree:

**Breadth truncation (sibling limit):** At any given depth level, if there are more siblings than Reddit wants to return, it includes some as full comment objects and replaces the rest with a single `"kind": "more"` object. The `children` array in the "more" object lists the IDs of comments that were cut. This is the most common form of truncation and is what produces the "load more comments (X replies)" links on the site.

**Depth truncation (nesting limit):** Reddit's default `.json` response typically caps nesting at around depth 8-10. When a reply chain goes deeper, Reddit replaces the deepest replies with a "more" object that has `id: "_"`, `count: 0`, and `children: []`. On the site, this renders as "Continue this thread -->". These "continue this thread" markers cannot be expanded via `/api/morechildren` -- they require a separate fetch to the comment permalink.

**Combined effect:** A large thread might have breadth truncation at depth 0 (hiding many top-level comments), depth truncation at depth 8 (hiding deep reply chains), and further breadth truncation at intermediate depths. The comment tree you receive is a pruned approximation of the actual tree.

### The 500-Comment Cap Implementation

The PRD specifies a 500-comment cap with "top-level comments plus 2 levels of replies." Here is how to implement that correctly:

1. Parse the full response from Reddit (which itself is already truncated).
2. Count parsed comment nodes. If count is under 500, use everything.
3. If over 500, apply a client-side filter: keep all depth-0 comments, their depth-1 replies, and depth-2 replies. Convert everything at depth 3+ into stub nodes.
4. If still over 500 after depth filtering (huge threads can have 500+ top-level comments alone), take the first 500 comments in tree-traversal order and stub the rest.
5. Set `isTruncated: true` on the ThreadData.

### Locked and Archived Threads

- **Locked** (`locked: true`): Thread exists, comments load normally, but new comments cannot be posted. No effect on `.json` response. Comments within a locked thread have their own `locked` field -- a mod can lock individual comments.
- **Archived** (`archived: true`): All posts older than 6 months were auto-archived until Reddit changed this in 2021. Some subreddits still opt into archiving. Archived threads cannot receive new votes or comments. The `.json` response is identical; the data is just stale.
- **Quarantined subreddits**: `.json` requests to quarantined subreddits return a `403` with a JSON body like `{"reason": "quarantined", ...}`. Unauthenticated requests cannot access these at all.
- **Private subreddits**: Return `403` with `{"reason": "private", ...}`. Same issue.
- **Banned subreddits**: Return `404`.

### Deleted and Removed Comments

This distinction is critical for accurate visualization:

**`[deleted]` (user-deleted):**
```json
{
  "kind": "t1",
  "data": {
    "author": "[deleted]",
    "body": "[deleted]",
    "score": 1,
    "...": "..."
  }
}
```
The user deleted their own comment. The comment node still exists in the tree (preserving reply structure), but `author` and `body` are both replaced with `"[deleted]"`. Score is reset to 1. Replies to deleted comments remain intact.

**`[removed]` (mod-removed):**
```json
{
  "kind": "t1",
  "data": {
    "author": "[deleted]",
    "body": "[removed]",
    "score": 1,
    "...": "..."
  }
}
```
A moderator (or AutoModerator, or Reddit's anti-spam) removed this comment. The `author` field shows `"[deleted]"` (same as user-deleted), but the `body` shows `"[removed]"`. **The author is NOT recoverable from the .json response in either case.**

**Edge case -- deleted with replies gone:** If a deleted/removed comment has no surviving replies, Reddit may omit it entirely from the tree. This creates "orphan" comments whose `parent_id` points to a node that does not exist in the response. **Your tree-builder must handle this.** If a comment's parent is missing, either:
- Reparent it to the post root node (treat as top-level), or
- Create a synthetic "missing parent" node

**Engineering recommendation:** In the graph, render deleted/removed comments as distinct visual states -- dimmed, smaller, or with a special icon. They are structurally important (they preserve tree shape) but content-empty.

### Contest Mode

When `contest_mode: true` on the post:
- Comment order is randomized in every response
- All comment scores show as 0 or are hidden (`score_hidden: true`)
- Reply counts may be suppressed
- The `.json` response returns comments in random order each time

This means: if you cache a contest-mode response, reloading the same thread will produce different comment ordering (though the same comments). For visualization this is fine since we are showing structure, not order. But sentiment analysis on score-0 comments is meaningless.

---

## 4. Content Edge Cases

### Reddit-Specific Markdown

Reddit uses a variant of Markdown. The `body` field contains raw Markdown; `body_html` contains Reddit's server-side rendering. Use `body_html` for display (after HTML entity decoding and DOMPurify sanitization), but use `body` for sentiment analysis (raw text without HTML noise).

**Reddit-specific syntax the parser must know about:**

| Syntax | Renders as | In `body` | In `body_html` |
|--------|-----------|-----------|-----------------|
| `>!spoiler text!<` | Spoiler blur | Raw with markers | `<span class="md-spoiler-text">spoiler text</span>` |
| `^superscript` or `^(multi word)` | Superscript | Raw with caret | `<sup>superscript</sup>` |
| `~~strikethrough~~` | Strikethrough | Raw with tildes | `<del>strikethrough</del>` |
| `# Heading` | H1 (rarely used in comments) | Raw with hash | `<h1>Heading</h1>` |
| `/s` or `\s` at end of comment | Sarcasm marker (cultural, not syntax) | Raw text | Raw text |
| `&gt;` quote blocks | Blockquote | `> quoted text` | `<blockquote>` |
| `/u/username` | User mention link | Raw | `<a href="/u/username">` |
| `/r/subreddit` | Subreddit link | Raw | `<a href="/r/subreddit">` |

**Sentiment analysis warning:** The `body_html` includes HTML entities (`&amp;`, `&lt;`, etc.) that are ALSO HTML-encoded once more in the JSON response. If you feed `body_html` to a sentiment analyzer, you will be analyzing HTML tags and entities. Always use `body` (raw markdown) for text analysis.

### Flair

Two types of flair appear in the data:

**Link flair** (on the post):
- `link_flair_text`: Plain text, e.g., `"Serious Replies Only"`, `"Megathread"`, `"[OC]"`
- `link_flair_richtext`: Array of rich text components with emojis: `[{"e": "text", "t": "Serious"}, {"e": "emoji", "a": ":snoo:", "u": "https://..."}]`
- `link_flair_css_class`: Subreddit-specific CSS class

**Author flair** (on comments):
- `author_flair_text`: Plain text
- `author_flair_richtext`: Same structure as above
- Flair varies per-subreddit. In r/science, flairs indicate academic credentials. In r/nfl, they indicate team loyalty. Context matters for interpretation.

For Thread Cartographer Phase 1, display `link_flair_text` on the post metadata. Author flair can be shown in the detail panel but is low-priority.

### Awards and Gilding

The awards structure has changed multiple times. Current format:

```json
{
  "all_awardings": [
    {
      "name": "Gold",
      "count": 3,
      "icon_url": "https://...",
      "description": "...",
      "coin_price": 500
    }
  ],
  "gilded": 2,
  "total_awards_received": 5
}
```

Reddit retired the awards system in September 2023 and reintroduced a simplified version. Older threads will have the full `all_awardings` array; newer threads may have fewer award types. For Phase 1, showing `total_awards_received` as a badge count in the detail panel is sufficient.

### AutoModerator Stickied Comments

In many subreddits, the first comment is always an AutoModerator sticky:

```json
{
  "kind": "t1",
  "data": {
    "author": "AutoModerator",
    "stickied": true,
    "distinguished": "moderator",
    "body": "This is a reminder that all comments must follow rule...",
    "score": 1,
    "depth": 0
  }
}
```

**How to identify:** `stickied: true` AND `distinguished: "moderator"` AND often `author: "AutoModerator"`.

**Engineering recommendation:** These comments are structurally present but conversationally irrelevant. Options:
1. Render them as a distinct node type (gray, smaller) -- recommended
2. Filter them out entirely (loses tree accuracy)
3. Collapse them by default

AutoMod stickied comments never have meaningful replies (people do reply to them, but those replies are usually rule-violation-related noise).

### Bot Comments

Common bot patterns to detect (for potential future filtering):

- `author` ends with `Bot`, `_bot`, `-bot`
- `author` matches known bots: `AutoModerator`, `RemindMeBot`, `RepostSleuthBot`, `SaveVideo`, `sneakpeekbot`, `WikiTextBot`, `GifReversingBot`, `stabbot`, `BotDefense`
- `body` contains `^(I am a bot)` or `*I am a bot*` or `beep boop`
- `body` starts with a formulaic pattern like `Here's a sneak peek of` or `Looks like a repost`

For Phase 1, no bot filtering is needed. But in the visualization, bot comments will appear as low-score, low-engagement leaf nodes. They are visual noise.

### Crosspost Data

When a post is a crosspost:

```json
{
  "kind": "t3",
  "data": {
    "crosspost_parent": "t3_xyz789",
    "crosspost_parent_list": [
      {
        "id": "xyz789",
        "title": "Original post title",
        "subreddit": "OriginalSubreddit",
        "author": "original_author",
        "...": "full post data of the original"
      }
    ]
  }
}
```

The `crosspost_parent_list` contains the FULL data of the original post(s). For Thread Cartographer, you only care about the comments on the crosspost itself (which are separate from the original). Display a note in the UI that this is a crosspost and optionally link to the original.

---

## 5. Rate Limit Behavior

### Response Headers

Reddit returns rate limit headers on every response from the `.json` endpoint:

```
X-Ratelimit-Remaining: 58.0
X-Ratelimit-Used: 2
X-Ratelimit-Reset: 487
```

- `X-Ratelimit-Remaining`: Float. How many requests you have left in the current window. Starts at ~60 for unauthenticated.
- `X-Ratelimit-Used`: Integer. How many requests you have made in the current window.
- `X-Ratelimit-Reset`: Integer. Seconds until the rate limit window resets. Reddit uses a 10-minute window (600 seconds), so this counts down from 600.

**The math:** 60 requests per 600-second window = effectively 6 requests per minute sustained, NOT 60/min as often cited. The "60 req/min" figure from Reddit's documentation refers to the peak burst capacity at the start of a window.

### What Happens When You Hit the Limit

1. **Soft throttle (approaching limit):** Reddit starts inserting artificial delays. Responses take 2-5 seconds instead of the usual 200-500ms. No error code, just slowness. This is invisible unless you are tracking response times.

2. **429 Too Many Requests:** When you exceed the limit, Reddit returns HTTP 429 with a JSON body:
```json
{"message": "Too Many Requests", "error": 429}
```
The response includes a `Retry-After` header (in seconds). Typical values are 60-600 seconds.

3. **Temporary IP ban:** Sustained abuse (ignoring 429s) results in all requests returning 429 for an extended period (hours). There is no formal documentation on the threshold.

### Unauthenticated vs Authenticated

| Behavior | Unauthenticated | OAuth |
|----------|-----------------|-------|
| Rate limit | ~60 per 10 min window | ~100 per 10 min window |
| Per-IP tracking | Yes (by IP) | Yes (by token + IP) |
| NSFW content | Blocked on some endpoints | Accessible |
| Quarantined subs | Blocked | Accessible (if opted in) |
| User-Agent required | Technically no, but strongly recommended | Yes (Reddit blocks generic UAs) |

### Real-World Recommendations for Thread Cartographer

With a 15-minute Redis cache TTL:
- A popular thread will be fetched once and served from cache for 15 minutes
- Under normal usage (a few users), you will never approach rate limits
- Under load (Product Hunt frontpage, Hacker News effect), multiple users requesting different threads could drain the limit fast
- **Always read and respect the `X-Ratelimit-Remaining` header.** If it drops below 10, slow down or queue requests.
- **Store rate limit state in Redis** alongside the cache. A simple key like `reddit:ratelimit` with the remaining count and reset time lets your API route make informed decisions before even hitting Reddit.
- **Set a User-Agent**: `ThreadCartographer/1.0 (contact: your@email.com)`. Reddit deprioritizes requests with generic or missing User-Agents.

---

## 6. Thread Types That Break Things

### AMAs (Ask Me Anything)

**Structure:** Hundreds or thousands of top-level comments (questions), with the AMA host's responses scattered 1-2 levels deep. The host's comments are identifiable via `is_submitter: true`.

**Challenges:**
- Enormous breadth at depth 0. The `.json` response may only include 50-100 top-level questions, with a massive "more" object hiding the rest.
- The interesting structure (host response chains) is sparse -- most top-level questions have no host response.
- Visualization recommendation: highlight `is_submitter` nodes distinctly (different color/shape) so the host's responses stand out.

### Megathreads (10K+ comments)

Examples: Super Bowl game threads, election night threads, breaking news megathreads.

**Challenges:**
- The `.json` response caps around 200-500 comments regardless of thread size. A 50K-comment thread returns the same ~200-500 initial comments as a 1000-comment thread.
- The "more" objects will have `count` values in the thousands.
- Many comments are low-effort, real-time reactions ("TOUCHDOWN!", "wow", "F").
- The comment tree is extremely broad (thousands of depth-0 comments) but shallow (most replies are depth 1-2).
- The 500-comment cap is essential here. Without it, even the initial parse is overwhelming.

### Live Threads

Reddit has a separate "live thread" feature (`reddit.com/live/...`). These use a completely different API and data format. **Do not attempt to handle live thread URLs.** The URL pattern is different (`/live/` not `/comments/`), so the allowlist regex should naturally exclude them.

### NSFW-Flagged Threads

When `over_18: true` on the post:
- Unauthenticated `.json` requests: Reddit MAY return the content or MAY return a 403/redirect depending on the subreddit settings and Reddit's current behavior (this has changed multiple times).
- The JSON structure is identical when accessible. No fields are redacted.
- Engineering recommendation: attempt the fetch normally. If it fails with a 403, return a clear error: "This thread is marked NSFW and cannot be accessed without authentication."

### Heavily Moderated Threads

Subreddits like r/science, r/AskHistorians, and r/NeutralPolitics aggressively remove off-topic comments. Result:

- Long chains of `[removed]` comments where entire branches were nuked
- Comments whose `parent_id` references a removed comment (which may or may not still exist in the JSON as a `[removed]` stub)
- Artificially sparse trees that look odd in visualization -- many root branches terminating immediately

**Visualization recommendation:** Show removed comments as a distinct visual state (faded/dashed border) rather than hiding them. The removal pattern itself tells a story about moderation activity.

### Threads in Non-English Languages

The `.json` response contains whatever language the users wrote in. AFINN sentiment scoring only works on English text. For non-English threads, sentiment analysis will produce near-zero scores for everything (no word matches), making the color coding meaningless.

**Recommendation for Phase 1:** Accept this limitation. Display a note when the average absolute sentiment score across all comments is very low (< 0.1 per word), suggesting the thread may be non-English or low-sentiment.

---

## 7. Sentiment Analysis on Reddit

### Why Reddit Text Is Uniquely Hard

Reddit is arguably the worst mainstream platform for naive sentiment analysis. Here is why:

**Sarcasm is the default register.** On most platforms, "This is just great" is positive. On Reddit, it is probably sarcastic. The `/s` sarcasm tag is used inconsistently -- experienced users consider it training wheels.

**Alternating caps = mockery.** "oH wOw WhAt A gReAt IdEa" is strongly negative sentiment expressed using positive words. AFINN will score this as positive.

**Copypasta.** Entire comments are copy-pasted memes. The Navy Seal copypasta contains extremely negative words but is humorous and carries no genuine sentiment. Same with "I sexually identify as an attack helicopter" and dozens of others.

**In-jokes and references.** "I also choose this guy's dead wife" is a beloved Reddit joke (positive sentiment in context) but contains "dead" (negative word). "We did it Reddit!" is always sarcastic (referencing the Boston bombing misidentification).

**Quote blocks.** Reddit comments frequently quote the parent comment or an article. The quoted text's sentiment is not the commenter's sentiment -- it is often the opposite (quoting something to disagree with it).

**Subreddit-specific slang:**
- r/WallStreetBets: "loss porn" (positive/humorous), "diamond hands" (positive), "retard" (term of endearment), "ape" (positive self-identifier)
- r/TIFU: Entire subreddit about personal failures, but tone is humorous/self-deprecating
- r/AmItheAsshole: "YTA" (you're the asshole) and "NTA" (not the asshole) are neutral judgments, not insults
- r/ExplainLikeImFive: Formal/educational tone, low emotional content
- r/SubredditDrama: Meta-commentary tone, everything is ironic

**Edit chains destroy sentiment:** A common pattern:
```
Great point about X.

Edit: wow this blew up
Edit 2: RIP my inbox
Edit 3: thanks for the gold kind stranger!
```
The original comment had real content. The edits are noise that dilute sentiment accuracy.

### AFINN Limitations to Document

AFINN-111 is a word list of ~2,477 English words scored from -5 (very negative) to +5 (very positive). It works decently for average text but has specific Reddit failure modes:

- "sick" scores negative (-2) but on Reddit often means "cool/amazing"
- "kill" scores negative (-3) but "kill it" means "do really well"
- "damn" scores negative (-2) but "damn that's good" is positive
- "ass" scores negative (-4) but is common in casual positive expressions
- Emoji are completely unscored
- URLs, code blocks, and formatting artifacts contribute nothing but aren't stripped

### Recommendation for Phase 1

Accept that sentiment analysis will be approximate. Specific mitigations:

1. **Strip quote blocks** (lines starting with `>`) before sentiment analysis -- the commenter is quoting someone else's words
2. **Strip URLs** -- they are not sentiment-bearing text
3. **Strip Reddit usernames** (`/u/username`) and subreddit links (`/r/subreddit`)
4. **Normalize the score per word count** -- a 500-word comment with two negative words is not negative, but raw sum scoring treats it as such. Use average sentiment per word, not sum.
5. **Treat "edited" comments with suspicion** -- if `edited` is a timestamp, the comment has been modified and the original sentiment may have been different
6. **Display sentiment as a spectrum**, not a hard classification. The blue/gray/orange palette is good for this -- most comments should land in gray (neutral) territory.

---

## 8. Visualization Recommendations

### What Reddit Users Actually Want to See

From the perspective of someone who has spent thousands of hours in Reddit threads, here is what makes a thread visualization interesting:

**Debate structure.** The most visually compelling threads are debates where two or more camps argue back and forth. These create deep, branching chains at specific nodes. A force-directed graph naturally reveals these "hot spots" -- nodes with many deep reply chains radiating from them. The graph should make it obvious which comments sparked the most discussion.

**The "pile-on" pattern.** When a comment gets hundreds of direct replies (all at depth+1) but few deeper chains, it means everyone wanted to respond to the same thing but nobody engaged with each other. This creates a distinctive star/hub pattern in the graph. These are typically controversial statements or questions in AMA threads.

**OP engagement.** In AMA threads and personal story threads, the most interesting pattern is where the original poster (OP) responded. Highlighting `is_submitter: true` nodes with a distinct color or border immediately shows OP's engagement pattern: did they answer deep follow-ups, or only respond to easy top-level questions?

**The "nuked thread" pattern.** In heavily moderated subreddits, entire branches get removed. The visualization shows this as branches that terminate in clusters of removed (dimmed) nodes. This is genuinely interesting to researchers and moderators.

**Score distribution.** Node sizing by score reveals which comments the community valued. In a good thread, the highest-scoring comments are often mid-depth (replies that add context or a counterargument), not depth-0 top-level comments.

### Thread Types That Produce the Best Visualizations

| Thread Type | Visual Pattern | Why It's Interesting |
|-------------|---------------|---------------------|
| Debate/controversial | Deep forking branches | Shows where disagreement lives |
| AMA | Star pattern at depth 0, sparse depth 1-2 | Shows interviewer engagement |
| AskReddit "what's your X" | Very broad depth 0, shallow depth 1-2 | Shows community participation breadth |
| News thread | Clusters of deep discussion on 3-4 subtopics | Shows topic fragmentation |
| Drama thread | One or two VERY deep chains | Shows escalation |
| r/AskHistorians | Few top-level, moderate depth | Shows quality over quantity |

### What Should the Detail Panel Highlight

When a user clicks a node:
- **Author** (with OP badge if `is_submitter`)
- **Score** (with "score hidden" indicator if applicable)
- **Comment text** (sanitized HTML, with spoiler tags rendered as blurred spans)
- **Depth level** (helps orient in the tree)
- **Reply count** (how many direct children this node has)
- **Age** (relative time from post creation, e.g., "posted 3 hours after thread creation")
- **Permalink** (link to this comment on Reddit)
- **Awards count** (if nonzero)
- **Controversiality flag** (if `controversiality: 1`, show a small indicator)

### Graph Controls That Matter

The PRD specifies a depth slider and score filter. Additional controls that would genuinely help:

- **Highlight OP comments** toggle -- makes AMAs immediately useful
- **Hide deleted/removed** toggle -- reduces noise
- **Show only controversial** filter (where `controversiality: 1`) -- surfaces the interesting parts of debates
- **Search by author** -- find a specific person's comments in the graph

Some of these are Phase 2+ but worth noting as design considerations so Phase 1's architecture does not preclude them.

---

## 9. Curated Test Threads

These threads cover the full spectrum of edge cases. Each is chosen for a specific testing purpose.

### Small and Simple (Full-Render Tests)

1. **Small discussion thread (~20-50 comments):**
   `https://www.reddit.com/r/ExplainLikeImFive/comments/1j7bygi/eli5_why_do_zippers_have_ykk_on_them/`
   Purpose: Full render, no truncation. Verify basic tree parsing, edge creation, and visualization.

2. **Small thread with deleted comments:**
   `https://www.reddit.com/r/AskReddit/comments/1fgiihr/what_is_a_conspiracy_theory_you_100_believe_is/`
   Purpose: Test handling of `[deleted]`/`[removed]` authors and bodies. Verify orphan comment handling.

### Medium (Cap Testing)

3. **Medium thread (~500-1000 comments):**
   `https://www.reddit.com/r/todayilearned/comments/1j53att/til_that_the_average_american_walks_about_3000_to/`
   Purpose: Approaches the 500-comment cap. Tests truncation logic boundary.

### Large (Stress Tests)

4. **Large AskReddit thread (10K+ comments):**
   `https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment_in_reddit/`
   Purpose: PRD reference thread. Tests 500-comment cap, massive "more" objects, performance.

5. **Megathread (50K+ comments):**
   `https://www.reddit.com/r/AskReddit/comments/5c79n0/he_sucks_but_who_teleported_a_horse_into_a/`
   Purpose: Extreme scale test. Verify the app does not choke on initial parse.

### Structural Edge Cases

6. **AMA thread:**
   `https://www.reddit.com/r/IAmA/comments/z1c9z/i_am_barack_obama_president_of_the_united_states/`
   Purpose: Classic AMA. Test `is_submitter` identification, star-pattern visualization, deep OP response chains.

7. **Controversial/debate thread:**
   `https://www.reddit.com/r/AmItheAsshole/comments/1iuojwi/aita_for_not_giving_my_daughter_her_college_fund/`
   Purpose: High `controversiality` flags, mixed sentiment, deep argument chains.

8. **Heavily moderated (r/science or r/AskHistorians):**
   `https://www.reddit.com/r/science/comments/1irrtcw/scientists_discover_New_New_New_earth/`
   Purpose: Many `[removed]` chains. Test nuked-branch visualization. (Note: use any recent r/science frontpage thread; moderation is aggressive on most posts.)

9. **Thread with deep nesting (10+ depth):**
   `https://www.reddit.com/r/AskReddit/comments/1dcpr0h/whats_the_most_ridiculous_lie_you_believed_as_a/`
   Purpose: Test "continue this thread" more objects, depth truncation handling.

10. **Locked thread:**
    `https://www.reddit.com/r/news/comments/1j5p2v5/major_news_event_thread/`
    Purpose: Verify `locked: true` does not break parsing. (Use any locked r/news thread.)

### Content Edge Cases

11. **NSFW thread:**
    `https://www.reddit.com/r/AskReddit/comments/1io7jd2/nsfw_what_is_something_you_did_once_and_never/`
    Purpose: Test `over_18: true` handling, potential 403 errors on unauthenticated fetch.

12. **Thread with lots of awards:**
    `https://www.reddit.com/r/pics/comments/haucpf/ive_found_a_few_funny_memories_during_the/`
    Purpose: Test `all_awardings` parsing, award count display. (Older threads from pre-award-retirement era have more awards.)

13. **Crosspost thread:**
    Search for any crosspost by checking for `crosspost_parent` in the JSON. Common in r/bestof or r/SubredditDrama.
    Purpose: Test `crosspost_parent_list` handling.

14. **Thread with AutoModerator sticky + contest mode:**
    Any r/AskReddit thread that is less than a few hours old will likely have `contest_mode: true` and an AutoMod sticky.
    Purpose: Test both edge cases together.

### Validation Strategy

For each test thread:
1. Fetch `{url}.json` manually and examine the raw response
2. Verify your parser extracts the expected number of nodes
3. Compare `num_comments` from the post metadata to actual parsed comment count (they WILL differ)
4. Check that all edges reference valid node IDs
5. Verify "more" objects are correctly converted to stub nodes
6. Confirm deleted/removed comments are visually distinct

---

## 10. Reddit Culture Context

### Things a Non-Reddit Engineer Will Misunderstand

**"Score" is not a like count.** Reddit scores are the result of upvotes minus downvotes, with fuzzing applied. A comment with score 5 might have 5 upvotes and 0 downvotes, or 500 upvotes and 495 downvotes. The raw numbers are hidden. This is why `controversiality` exists as a separate flag.

**Negative scores are meaningful.** A comment at -50 is not just unpopular; it was actively suppressed by the community. Reddit collapses comments below a score threshold (usually -4 or -5). In the JSON, collapsed comments still appear but have `collapsed: true`. Negative-score comments should be visually distinct in the graph -- they represent community disagreement, which is genuinely interesting data.

**"Controversial" does not mean "few votes."** Reddit's "controversial" sort surfaces comments with a high total vote count but a near-50/50 split between up and down. A comment with 1000 upvotes and 900 downvotes (score: 100, `controversiality: 1`) is far more interesting than a comment with 100 upvotes and 0 downvotes (score: 100, `controversiality: 0`). The first represents genuine community conflict; the second represents consensus.

**High-score comments are not always good.** Several patterns produce high scores without quality:
- **First-mover advantage:** The first comment posted in a popular thread gets massive score just by being early
- **Pun chains:** The first pun in a chain gets 5000 upvotes; each subsequent pun gets less. They are low-information
- **"Edit: thanks for the gold kind stranger!"** edits. Comments that edit to celebrate their own score are universally mocked but remain high-scoring
- **Award bait:** Comments that are intentionally heartwarming, contrarian-but-safe, or perfectly timed for the Reddit audience

**Subreddit context changes everything.** The same text means different things in different subreddits:
- "This." in r/philosophy is a lazy agreement (negative reception). In r/programming it might reference the `this` keyword.
- A long, detailed comment in r/AskHistorians is expected (good). The same length in r/memes is bizarre.
- Profanity in r/CasualUK is normal English. In r/AskScience it would be removed.

Thread Cartographer should display the subreddit prominently because it is essential context for interpreting everything in the graph.

**"OP" has special status.** The original poster's comments are highlighted by Reddit with a microphone icon and blue username. In AMAs, OP responses are the entire point. In advice threads, OP responses reveal whether they accept or reject advice. In the graph, `is_submitter: true` comments deserve visual distinction -- they are narratively important regardless of score.

**Time matters enormously.** A comment posted 30 seconds after the thread was created will have a fundamentally different score trajectory than one posted 12 hours later. Early comments accrue votes exponentially. Late comments in large threads are essentially invisible regardless of quality. The `created_utc` timestamp on each comment, compared to the post's `created_utc`, gives you "reply age" -- which correlates strongly with score in ways that have nothing to do with comment quality.

**"Edit:" annotations are cultural, not technical.** Reddit convention (not enforcement) is to note what you changed when editing. The `edited` field tells you IF the comment was edited (and when), but not what changed. Common edit patterns:
- `Edit: grammar` -- trivial change
- `Edit: wow this blew up` -- score-celebration (noise)
- `Edit: to everyone saying X, I meant Y` -- substantive clarification that changes meaning
- `Edit: I was wrong, see reply below` -- retraction (valuable context for visualization)

None of these are machine-parseable. They exist in the `body` text as plain strings.

**Voting is tribal.** Reddit's vote-fuzzing algorithm prevents exact counts, but the displayed score on comments is generally accurate within a few percent. What is NOT apparent from scores alone is that voting is heavily influenced by:
- Early votes set the trajectory (bandwagon effect)
- Subreddit alignment (posting a pro-nuclear comment in an anti-nuclear subreddit guarantees downvotes regardless of quality)
- Thread context (the same comment gets different scores in different threads)

This is why sentiment analysis based purely on score is misleading. Score measures community agreement, not objective quality or sentiment.

**The front page effect.** When a thread reaches r/all (Reddit's front page), the commenting population changes dramatically. Early comments are from subreddit regulars; later comments are from the general Reddit population. This creates a visible shift in tone, vocabulary, and voting patterns partway through the thread. In the visualization, this manifests as a burst of new depth-0 comments with different sentiment characteristics than the early ones.

---

## Appendix: Quick Reference for Common Pitfalls

| Pitfall | What Goes Wrong | Fix |
|---------|----------------|-----|
| `replies` is `""` not null | TypeError when accessing `.data.children` | Check `typeof replies === 'object'` before traversal |
| `parent_id` has `t1_`/`t3_` prefix | Edge source/target IDs don't match node IDs | Strip prefix consistently |
| `body_html` is double-encoded | HTML entities display as literal text | Decode HTML entities before DOMPurify |
| `edited` is bool OR timestamp | Type error when treating as boolean | Check `if (edited !== false)` |
| `downs` always 0 | Misleading if displayed to user | Don't show downvote counts |
| `score_hidden: true` | Score shows as 1 but means "unknown" | Display "score hidden" instead of "1" |
| "more" with `count: 0` | Stub shows "load more (0 comments)" | This is a "continue thread" marker, label accordingly |
| `num_comments` != parsed count | User sees "847 comments" but graph shows 200 nodes | Display both: "Showing 200 of 847 comments" |
| Quarantined subreddits | 403 with no useful error message | Catch 403, check response body for `"reason"` field |
| `redd.it` short URLs | `.json` appending fails (redirect-based URLs) | Reject or resolve redirect before processing |
| Contest mode threads | Scores all 0, order random | Detect `contest_mode: true`, disable sentiment-by-score features |
| Non-ASCII/emoji in `body` | AFINN scoring returns 0 | Expected behavior, not a bug -- document the limitation |
