import { describe, it, expect } from "vitest";
import { extractThreadId } from "@/lib/cache";

describe("extractThreadId", () => {
  it("extracts thread ID from standard URL", () => {
    expect(
      extractThreadId("https://www.reddit.com/r/AskReddit/comments/t0ynr/what_is_the_most_downvoted_comment/")
    ).toBe("t0ynr");
  });

  it("extracts thread ID from old.reddit URL", () => {
    expect(
      extractThreadId("https://old.reddit.com/r/programming/comments/abc123/some_title/")
    ).toBe("abc123");
  });

  it("extracts thread ID from URL with .json suffix", () => {
    expect(
      extractThreadId("https://www.reddit.com/r/AskReddit/comments/t0ynr/.json")
    ).toBe("t0ynr");
  });

  it("extracts thread ID from URL with query params", () => {
    expect(
      extractThreadId("https://www.reddit.com/r/AskReddit/comments/t0ynr/?sort=top&limit=500")
    ).toBe("t0ynr");
  });

  it("strips comment permalink to thread ID (Gotcha #10)", () => {
    // Comment permalink: .../comments/abc123/title/def456/
    // Should extract abc123 (thread ID), not def456 (comment ID)
    expect(
      extractThreadId("https://www.reddit.com/r/AskReddit/comments/abc123/some_title/def456/")
    ).toBe("abc123");
  });

  it("handles URL without trailing slash", () => {
    expect(
      extractThreadId("https://www.reddit.com/r/AskReddit/comments/t0ynr")
    ).toBe("t0ynr");
  });

  it("returns null for non-Reddit URL", () => {
    expect(extractThreadId("https://google.com")).toBeNull();
  });

  it("returns null for Reddit URL without thread ID", () => {
    expect(extractThreadId("https://www.reddit.com/r/AskReddit/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractThreadId("")).toBeNull();
  });

  it("handles reddit.com without www", () => {
    expect(
      extractThreadId("https://reddit.com/r/test/comments/xyz789/title/")
    ).toBe("xyz789");
  });
});
