import { describe, it, expect } from "vitest";
import { GET, POST } from "@/app/api/thread/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

function loadFixture(name: string) {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "tests/fixtures/reddit", name),
      "utf-8"
    )
  );
}

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/thread?url=${encodeURIComponent(url)}`)
  );
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/thread", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/thread", () => {
  it("returns 400 for missing url param", async () => {
    const req = new NextRequest("http://localhost:3000/api/thread");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("MISSING_URL");
  });

  it("returns 400 for non-Reddit URL", async () => {
    const res = await GET(makeGetRequest("https://google.com"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_URL");
  });

  it("returns 400 with SHORT_URL for redd.it URLs", async () => {
    const res = await GET(makeGetRequest("https://redd.it/abc123"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("SHORT_URL");
  });

  it("returns 404 (cache miss) for valid but uncached URL", async () => {
    const res = await GET(
      makeGetRequest(
        "https://www.reddit.com/r/test/comments/uncached123/title/"
      )
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.data).toBeNull();
    expect(data.meta.cached).toBe(false);
    expect(res.headers.get("X-Cache")).toBe("MISS");
  });
});

describe("POST /api/thread", () => {
  it("returns 400 for missing url field", async () => {
    const res = await POST(makePostRequest({ redditData: {} }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("MISSING_URL");
  });

  it("returns 400 for missing redditData field", async () => {
    const res = await POST(
      makePostRequest({
        url: "https://www.reddit.com/r/test/comments/abc123/title/",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("MISSING_DATA");
  });

  it("returns 400 for invalid Reddit JSON", async () => {
    const res = await POST(
      makePostRequest({
        url: "https://www.reddit.com/r/test/comments/abc123/title/",
        redditData: { not: "valid" },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_DATA");
  });

  it("returns 400 for non-Reddit URL", async () => {
    const res = await POST(
      makePostRequest({
        url: "https://google.com",
        redditData: loadFixture("small-thread.json"),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_URL");
  });

  it("processes valid small thread fixture successfully", async () => {
    const fixture = loadFixture("small-thread.json");
    const postData = fixture[0].data.children[0].data;
    const threadId = postData.id;

    const res = await POST(
      makePostRequest({
        url: `https://www.reddit.com/r/${postData.subreddit}/comments/${threadId}/title/`,
        redditData: fixture,
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toBeDefined();
    expect(data.data.threadId).toBe(threadId);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.edges.length).toBeGreaterThan(0);
    expect(data.data.sanitized).toBe(true);
    expect(data.meta.cached).toBe(false);
  });

  it("processes empty thread fixture (0 comments)", async () => {
    const fixture = loadFixture("empty-thread.json");
    const res = await POST(
      makePostRequest({
        url: "https://www.reddit.com/r/test/comments/empty01/title/",
        redditData: fixture,
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.nodes.length).toBe(1); // root only
    expect(data.data.edges.length).toBe(0);
  });

  it("strips XSS from comment HTML", async () => {
    const fixture = loadFixture("xss-comments.json");
    const res = await POST(
      makePostRequest({
        url: "https://www.reddit.com/r/test/comments/xssthread/title/",
        redditData: fixture,
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    for (const node of data.data.nodes) {
      expect(node.bodyHtml).not.toContain("<script>");
      expect(node.bodyHtml).not.toContain("onerror");
      expect(node.bodyHtml).not.toContain("javascript:");
    }
  });

  it("returns 400 for invalid request body", async () => {
    const req = new NextRequest("http://localhost:3000/api/thread", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not valid json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_BODY");
  });
});
