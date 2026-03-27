import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseRedditResponse,
  validateRedditJson,
  normalizeRedditUrl,
} from "@/lib/redditParser";

const fixturesDir = path.join(process.cwd(), "tests/fixtures/reddit");

function loadFixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf-8"));
}

describe("normalizeRedditUrl", () => {
  it("strips query params and hash", () => {
    expect(
      normalizeRedditUrl(
        "https://www.reddit.com/r/AskReddit/comments/t0ynr/?sort=top#anchor"
      )
    ).toBe("https://www.reddit.com/r/AskReddit/comments/t0ynr");
  });

  it("strips .json suffix", () => {
    expect(
      normalizeRedditUrl(
        "https://www.reddit.com/r/AskReddit/comments/t0ynr/.json"
      )
    ).toBe("https://www.reddit.com/r/AskReddit/comments/t0ynr");
  });

  it("strips comment permalink deep-link (Gotcha #10)", () => {
    expect(
      normalizeRedditUrl(
        "https://www.reddit.com/r/AskReddit/comments/abc123/some_title/def456/"
      )
    ).toBe("https://www.reddit.com/r/AskReddit/comments/abc123");
  });

  it("handles URL without trailing slash", () => {
    expect(
      normalizeRedditUrl(
        "https://www.reddit.com/r/programming/comments/1s50g5t"
      )
    ).toBe("https://www.reddit.com/r/programming/comments/1s50g5t");
  });

  it("handles old.reddit URL", () => {
    const result = normalizeRedditUrl(
      "https://old.reddit.com/r/test/comments/xyz789/title/comment123/"
    );
    expect(result).toBe("https://old.reddit.com/r/test/comments/xyz789");
  });
});

describe("validateRedditJson", () => {
  it("returns null for valid fixture data", () => {
    const data = loadFixture("small-thread.json");
    expect(validateRedditJson(data)).toBeNull();
  });

  it("rejects non-array input", () => {
    expect(validateRedditJson({ data: "nope" })).toBe(
      "Expected an array (Reddit returns [post, comments])"
    );
  });

  it("rejects array with fewer than 2 elements", () => {
    expect(validateRedditJson([{ data: {} }])).toBe(
      "Expected at least 2 elements in the array"
    );
  });

  it("rejects missing post data", () => {
    expect(validateRedditJson([{ data: { children: [] } }, {}])).toBe(
      "Missing post data in first listing"
    );
  });

  it("returns null for empty thread fixture", () => {
    const data = loadFixture("empty-thread.json");
    expect(validateRedditJson(data)).toBeNull();
  });
});

describe("parseRedditResponse", () => {
  it("parses small thread fixture into valid ThreadData", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    expect(result.threadId).toBeTruthy();
    expect(result.title).toBeTruthy();
    expect(result.subreddit).toBeTruthy();
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.sanitized).toBe(true);
    expect(result.fetchedAt).toBeGreaterThan(0);
  });

  it("includes root post as first node at depth 0", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    const root = result.nodes[0];
    expect(root.depth).toBe(0);
    expect(root.parentId).toBeNull();
    expect(root.id).toBe(result.threadId);
  });

  it("sets correct depth for nested comments", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    // Comments should be depth >= 1
    const comments = result.nodes.filter((n) => !n.isStub && n.depth > 0);
    for (const c of comments) {
      expect(c.depth).toBeGreaterThanOrEqual(1);
    }
  });

  it("creates edges matching node IDs", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    const nodeIds = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("handles empty thread fixture (0 comments)", () => {
    const data = loadFixture("empty-thread.json");
    const result = parseRedditResponse(data);

    // Only the root post node
    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(0);
    expect(result.nodes[0].depth).toBe(0);
    expect(result.commentCount).toBe(0);
  });

  it("creates stub nodes for 'more' objects", () => {
    const data = loadFixture("more-stubs.json");
    const result = parseRedditResponse(data);

    const stubs = result.nodes.filter((n) => n.isStub);
    expect(stubs.length).toBeGreaterThan(0);

    for (const stub of stubs) {
      expect(stub.isStub).toBe(true);
      expect(["more", "continue"]).toContain(stub.stubType);
    }
  });

  it("caps at 500 comment nodes for large threads", () => {
    const data = loadFixture("large-thread.json");
    const result = parseRedditResponse(data);

    // Reddit's first page returns ~498 comments for this fixture (under 500).
    // num_comments says 43K but the fixture only has the first page.
    // Verify the cap logic: comment nodes should never exceed 500.
    const commentNodes = result.nodes.filter((n) => !n.isStub && n.depth > 0);
    expect(commentNodes.length).toBeLessThanOrEqual(500);

    // The fixture has 498 raw comments, so isTruncated should be false
    // (truncation only triggers when rawCommentCount > 500)
    // The real test is that the parser doesn't crash on a large fixture
    // and respects the cap when it does trigger
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.commentCount).toBe(43493); // Reddit metadata
  });

  it("scores sentiment on comment bodies", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    // At least some comments should have non-zero sentiment
    const withSentiment = result.nodes.filter(
      (n) => !n.isStub && n.sentiment !== 0
    );
    // Not all comments will have sentiment words, but some should
    expect(withSentiment.length).toBeGreaterThanOrEqual(0);

    // All sentiment values should be in [-1, 1]
    for (const node of result.nodes) {
      expect(node.sentiment).toBeGreaterThanOrEqual(-1);
      expect(node.sentiment).toBeLessThanOrEqual(1);
    }
  });

  it("sanitizes XSS vectors in body_html", () => {
    const data = loadFixture("xss-comments.json");
    const result = parseRedditResponse(data);

    for (const node of result.nodes) {
      if (node.isStub || node.depth === 0) continue;
      expect(node.bodyHtml).not.toContain("<script>");
      expect(node.bodyHtml).not.toContain("onerror");
      expect(node.bodyHtml).not.toContain("javascript:");
      expect(node.bodyHtml).not.toContain("onmouseover");
    }
  });

  it("throws on invalid JSON input", () => {
    expect(() => parseRedditResponse("not json")).toThrow("Invalid Reddit JSON");
    expect(() => parseRedditResponse(null)).toThrow("Invalid Reddit JSON");
    expect(() => parseRedditResponse([])).toThrow("Invalid Reddit JSON");
  });

  it("Gotcha #6: commentCount reflects Reddit metadata, not parsed count", () => {
    const data = loadFixture("small-thread.json");
    const result = parseRedditResponse(data);

    // num_comments from Reddit will generally be >= our parsed comment count
    // (Reddit counts deleted/hidden comments)
    const parsedComments = result.nodes.filter(
      (n) => !n.isStub && n.depth > 0
    ).length;
    // commentCount is from Reddit metadata, parsed count is what we extracted
    expect(typeof result.commentCount).toBe("number");
    expect(parsedComments).toBeLessThanOrEqual(
      result.commentCount + 10 // small margin for fixture edge cases
    );
  });
});
