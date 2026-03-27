import { describe, it, expect } from "vitest";
import { decodeHtmlEntities, sanitizeHtml } from "@/lib/sanitize";

describe("decodeHtmlEntities", () => {
  it("decodes double-encoded HTML entities (Gotcha #3)", () => {
    expect(decodeHtmlEntities("&lt;p&gt;hello&lt;/p&gt;")).toBe("<p>hello</p>");
  });

  it("decodes ampersands", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
  });

  it("decodes quotes", () => {
    expect(decodeHtmlEntities("&quot;hello&quot;")).toBe('"hello"');
  });

  it("leaves already-decoded text unchanged", () => {
    expect(decodeHtmlEntities("<p>hello</p>")).toBe("<p>hello</p>");
  });

  it("handles mixed encoded and decoded content", () => {
    expect(decodeHtmlEntities("&lt;b&gt;bold&lt;/b&gt; and <i>italic</i>")).toBe(
      "<b>bold</b> and <i>italic</i>"
    );
  });
});

describe("sanitizeHtml", () => {
  it("strips script tags", async () => {
    const result = await sanitizeHtml("<script>alert('xss')</script><p>safe</p>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("<p>safe</p>");
  });

  it("strips event handlers", async () => {
    const result = await sanitizeHtml('<img src="x" onerror="alert(\'xss\')">');
    expect(result).not.toContain("onerror");
  });

  it("strips javascript: URLs", async () => {
    const result = await sanitizeHtml('<a href="javascript:alert(\'xss\')">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("preserves allowed formatting tags", async () => {
    const result = await sanitizeHtml("<p><strong>bold</strong> and <em>italic</em></p>");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("preserves links with href", async () => {
    const result = await sanitizeHtml('<a href="https://reddit.com">link</a>');
    expect(result).toContain('href="https://reddit.com"');
  });

  it("strips data attributes", async () => {
    const result = await sanitizeHtml('<div data-evil="payload">text</div>');
    expect(result).not.toContain("data-evil");
  });

  it("decodes Reddit double-encoding then sanitizes", async () => {
    // Reddit sends: &lt;script&gt;alert('xss')&lt;/script&gt;
    const result = await sanitizeHtml("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("skipSanitize option only decodes entities", async () => {
    const result = await sanitizeHtml(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
      { skipSanitize: true }
    );
    expect(result).toBe("<script>alert('xss')</script>");
  });
});
