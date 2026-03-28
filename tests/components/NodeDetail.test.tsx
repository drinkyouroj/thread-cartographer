// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NodeDetail from "@/components/NodeDetail";
import type { CommentNode } from "@/lib/types";

const mockNode: CommentNode = {
  id: "abc123",
  author: "testuser",
  body: "This is a great comment",
  bodyHtml: "<p>This is a <strong>great</strong> comment</p>",
  score: 42,
  scoreHidden: false,
  depth: 2,
  parentId: "parent1",
  permalink: "/r/test/comments/abc/title/abc123/",
  createdUtc: 1700000000,
  isStub: false,
  sentiment: 0.4,
};

describe("NodeDetail", () => {
  it("renders nothing visible when node is null", () => {
    const { container } = render(<NodeDetail node={null} onClose={vi.fn()} />);
    const panel = container.querySelector(".node-detail");
    expect(panel?.classList.contains("node-detail--open")).toBe(false);
  });

  it("renders author name when node is provided", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    expect(screen.getByText("u/testuser")).toBeDefined();
  });

  it("displays score when not hidden", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    expect(screen.getByText("42")).toBeDefined();
  });

  it("displays 'hidden' when score is hidden", () => {
    render(
      <NodeDetail
        node={{ ...mockNode, scoreHidden: true }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("hidden")).toBeDefined();
  });

  it("displays depth", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    expect(screen.getByText("2")).toBeDefined();
  });

  it("displays sentiment label with correct color for positive sentiment", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    const sentimentEl = screen.getByText("Positive");
    expect(sentimentEl).toBeDefined();
    expect(sentimentEl.style.color).toBe("var(--sentiment-positive)");
  });

  it("displays neutral sentiment for values in range", () => {
    render(
      <NodeDetail
        node={{ ...mockNode, sentiment: 0.0 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Neutral")).toBeDefined();
  });

  it("displays negative sentiment", () => {
    render(
      <NodeDetail
        node={{ ...mockNode, sentiment: -0.5 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Negative")).toBeDefined();
  });

  it("renders sanitized HTML content", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    const html = screen.getByText("great");
    expect(html.tagName).toBe("STRONG");
  });

  it("renders stub notice for 'more' stubs", () => {
    render(
      <NodeDetail
        node={{ ...mockNode, isStub: true, stubType: "more", childCount: 15 }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("15 more comments not loaded")).toBeDefined();
  });

  it("renders stub notice for 'continue' stubs", () => {
    render(
      <NodeDetail
        node={{ ...mockNode, isStub: true, stubType: "continue" }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Continue this thread on Reddit")).toBeDefined();
  });

  it("renders permalink to Reddit", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /view on reddit/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toContain("reddit.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<NodeDetail node={mockNode} onClose={onClose} />);

    const closeBtn = screen.getByLabelText("Close detail panel");
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    const { container } = render(
      <NodeDetail node={mockNode} onClose={onClose} />
    );

    const panel = container.querySelector(".node-detail")!;
    fireEvent.keyDown(panel, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has accessible complementary role", () => {
    render(<NodeDetail node={mockNode} onClose={vi.fn()} />);
    const panel = screen.getByRole("complementary", { name: /comment detail/i });
    expect(panel).toBeDefined();
  });

  it("sets aria-hidden when closed", () => {
    render(<NodeDetail node={null} onClose={vi.fn()} />);
    const panel = screen.getByRole("complementary", { hidden: true });
    expect(panel.getAttribute("aria-hidden")).toBe("true");
  });

  it("traps focus: Tab on last element wraps to first", () => {
    const { container } = render(
      <NodeDetail node={mockNode} onClose={vi.fn()} />
    );

    const panel = container.querySelector(".node-detail")!;
    const closeBtn = screen.getByLabelText("Close detail panel");
    const permalink = screen.getByRole("link", { name: /view on reddit/i });

    // Focus the last focusable element (permalink)
    (permalink as HTMLElement).focus();
    expect(document.activeElement).toBe(permalink);

    // Tab should wrap to first focusable (close button)
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("traps focus: Shift+Tab on first element wraps to last", () => {
    const { container } = render(
      <NodeDetail node={mockNode} onClose={vi.fn()} />
    );

    const panel = container.querySelector(".node-detail")!;
    const closeBtn = screen.getByLabelText("Close detail panel");
    const permalink = screen.getByRole("link", { name: /view on reddit/i });

    // Focus the first focusable element (close button)
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab should wrap to last focusable (permalink)
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(permalink);
  });
});
