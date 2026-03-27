# Test Fixtures

Captured 2026-03-27 for Thread Cartographer unit and integration tests.

## Fixtures

| File | Source | Type | Description |
|------|--------|------|-------------|
| `small-thread.json` | `r/programming/comments/1s50g5t` | Live capture | ~48 comments, full tree, happy path |
| `large-thread.json` | `r/AskReddit/comments/t0ynr` | Live capture | ~43K comments, triggers 500-cap |
| `more-stubs.json` | `r/programming/comments/1qoxwdt` (limit=50) | Live capture | Contains `"kind": "more"` objects |
| `comment-permalink.json` | `r/programming/comments/1s50g5t/x/ocr53ea` | Live capture | Scoped subtree (comment permalink) |
| `empty-thread.json` | Manually created | Synthetic | Thread with 0 comments |
| `xss-comments.json` | Manually created | Synthetic | 4 comments with XSS vectors in body_html |

## Refreshing Fixtures

If Reddit's response format changes or tests fail against stale fixtures:

```bash
curl -s -A "ThreadCartographer/1.0" "https://www.reddit.com/r/programming/comments/{THREAD_ID}/.json?limit=100" -o tests/fixtures/reddit/small-thread.json
```

Replace `{THREAD_ID}` with a current valid thread. Update this README with the new source URL and date.
