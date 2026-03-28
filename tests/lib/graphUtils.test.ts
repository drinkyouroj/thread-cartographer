import { describe, it, expect, vi } from "vitest";
import {
  nodeRadius,
  sentimentColor,
  screenToGraph,
  graphToScreen,
  findNodeAtPoint,
  drawNode,
  drawEdge,
  MIN_RADIUS,
  MAX_RADIUS,
  SENTIMENT_COLORS,
  EDGE_COLOR,
  EDGE_HOVER_COLOR,
} from "@/lib/graphUtils";
import type { SimulationNode } from "@/lib/types";
import { zoomIdentity } from "d3-zoom";

// ── Helper: create a SimulationNode ─────────────────────────────────

function makeNode(overrides: Partial<SimulationNode> = {}): SimulationNode {
  return {
    id: "test",
    author: "user",
    body: "text",
    bodyHtml: "<p>text</p>",
    score: 10,
    scoreHidden: false,
    depth: 1,
    parentId: null,
    permalink: "/r/test/comments/abc/test/",
    createdUtc: 1700000000,
    isStub: false,
    sentiment: 0.0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...overrides,
  };
}

// ── Mock CanvasRenderingContext2D ────────────────────────────────────

function mockCtx(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

// ── nodeRadius ──────────────────────────────────────────────────────

describe("nodeRadius", () => {
  it("returns MIN_RADIUS for lowest score", () => {
    const r = nodeRadius(0, false, [0, 50, 100]);
    expect(r).toBe(MIN_RADIUS);
  });

  it("returns MAX_RADIUS for highest score", () => {
    const r = nodeRadius(100, false, [0, 50, 100]);
    expect(r).toBe(MAX_RADIUS);
  });

  it("returns midpoint radius for middle score", () => {
    const r = nodeRadius(50, false, [0, 50, 100]);
    expect(r).toBe((MIN_RADIUS + MAX_RADIUS) / 2);
  });

  it("clamps to MIN_RADIUS/MAX_RADIUS", () => {
    const r1 = nodeRadius(-10, false, [0, 100]);
    const r2 = nodeRadius(200, false, [0, 100]);
    expect(r1).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(r2).toBeLessThanOrEqual(MAX_RADIUS);
  });

  it("returns midpoint when all scores are equal", () => {
    const r = nodeRadius(5, false, [5, 5, 5]);
    expect(r).toBe((MIN_RADIUS + MAX_RADIUS) / 2);
  });

  it("returns median radius when scoreHidden is true", () => {
    const r = nodeRadius(999, true, [0, 50, 100]);
    // Median score is 50 → mid-range radius
    expect(r).toBe((MIN_RADIUS + MAX_RADIUS) / 2);
  });

  it("returns midpoint for empty allScores with scoreHidden", () => {
    const r = nodeRadius(0, true, []);
    expect(r).toBe((MIN_RADIUS + MAX_RADIUS) / 2);
  });

  it("returns MIN_RADIUS for empty allScores without scoreHidden", () => {
    const r = nodeRadius(0, false, []);
    expect(r).toBe(MIN_RADIUS);
  });
});

// ── sentimentColor ──────────────────────────────────────────────────

describe("sentimentColor", () => {
  it("returns positive color for sentiment > 0.2", () => {
    expect(sentimentColor(0.5)).toBe(SENTIMENT_COLORS.positive);
  });

  it("returns negative color for sentiment < -0.2", () => {
    expect(sentimentColor(-0.5)).toBe(SENTIMENT_COLORS.negative);
  });

  it("returns neutral for sentiment at 0", () => {
    expect(sentimentColor(0)).toBe(SENTIMENT_COLORS.neutral);
  });

  it("returns neutral at boundary 0.2", () => {
    expect(sentimentColor(0.2)).toBe(SENTIMENT_COLORS.neutral);
  });

  it("returns neutral at boundary -0.2", () => {
    expect(sentimentColor(-0.2)).toBe(SENTIMENT_COLORS.neutral);
  });
});

// ── Coordinate transforms ───────────────────────────────────────────

describe("screenToGraph", () => {
  it("returns identity when no zoom applied", () => {
    const [gx, gy] = screenToGraph(100, 200, zoomIdentity);
    expect(gx).toBe(100);
    expect(gy).toBe(200);
  });

  it("inverts a scaled transform", () => {
    const transform = zoomIdentity.scale(2);
    const [gx, gy] = screenToGraph(200, 400, transform);
    expect(gx).toBeCloseTo(100);
    expect(gy).toBeCloseTo(200);
  });

  it("inverts a translated transform", () => {
    const transform = zoomIdentity.translate(50, 100);
    const [gx, gy] = screenToGraph(150, 300, transform);
    expect(gx).toBeCloseTo(100);
    expect(gy).toBeCloseTo(200);
  });
});

describe("graphToScreen", () => {
  it("returns identity when no zoom applied", () => {
    const [sx, sy] = graphToScreen(100, 200, zoomIdentity);
    expect(sx).toBe(100);
    expect(sy).toBe(200);
  });

  it("applies a scaled transform", () => {
    const transform = zoomIdentity.scale(2);
    const [sx, sy] = graphToScreen(100, 200, transform);
    expect(sx).toBeCloseTo(200);
    expect(sy).toBeCloseTo(400);
  });

  it("roundtrips with screenToGraph", () => {
    const transform = zoomIdentity.translate(30, 50).scale(1.5);
    const [gx, gy] = screenToGraph(200, 300, transform);
    const [sx, sy] = graphToScreen(gx, gy, transform);
    expect(sx).toBeCloseTo(200);
    expect(sy).toBeCloseTo(300);
  });
});

// ── findNodeAtPoint ─────────────────────────────────────────────────

describe("findNodeAtPoint", () => {
  it("returns null for empty node array", () => {
    const result = findNodeAtPoint(0, 0, [], zoomIdentity, []);
    expect(result).toBeNull();
  });

  it("finds a node at its center", () => {
    const node = makeNode({ id: "a", x: 100, y: 100, score: 50 });
    const result = findNodeAtPoint(100, 100, [node], zoomIdentity, [50]);
    expect(result).toBe(node);
  });

  it("finds a node within its radius", () => {
    const node = makeNode({ id: "a", x: 100, y: 100, score: 50 });
    // Click slightly off-center (within radius)
    const result = findNodeAtPoint(105, 100, [node], zoomIdentity, [0, 50, 100]);
    expect(result).toBe(node);
  });

  it("returns null when clicking outside all nodes", () => {
    const node = makeNode({ id: "a", x: 100, y: 100, score: 50 });
    // Click far away
    const result = findNodeAtPoint(500, 500, [node], zoomIdentity, [50]);
    expect(result).toBeNull();
  });

  it("returns closest node when multiple overlap", () => {
    const nodeA = makeNode({ id: "a", x: 100, y: 100, score: 50 });
    const nodeB = makeNode({ id: "b", x: 110, y: 100, score: 50 });
    // Click at 105 — closer to nodeA (distance 5) than nodeB (distance 5) but both in range
    const result = findNodeAtPoint(
      103, 100, [nodeA, nodeB], zoomIdentity, [50]
    );
    expect(result?.id).toBe("a");
  });

  it("accounts for zoom transform", () => {
    const node = makeNode({ id: "a", x: 50, y: 50, score: 50 });
    // Zoom 2x: screen coordinate (100, 100) maps to graph (50, 50)
    const transform = zoomIdentity.scale(2);
    const result = findNodeAtPoint(100, 100, [node], transform, [50]);
    expect(result).toBe(node);
  });
});

// ── drawNode ────────────────────────────────────────────────────────

describe("drawNode", () => {
  it("draws a circle at the correct screen position", () => {
    const ctx = mockCtx();
    const node = makeNode({ x: 100, y: 200, sentiment: 0.5 });
    drawNode(ctx, node, 10, zoomIdentity);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledWith(100, 200, 10, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe(SENTIMENT_COLORS.positive);
  });

  it("uses correct color for negative sentiment", () => {
    const ctx = mockCtx();
    const node = makeNode({ sentiment: -0.5 });
    drawNode(ctx, node, 8, zoomIdentity);
    expect(ctx.fillStyle).toBe(SENTIMENT_COLORS.negative);
  });

  it("uses correct color for neutral sentiment", () => {
    const ctx = mockCtx();
    const node = makeNode({ sentiment: 0.0 });
    drawNode(ctx, node, 8, zoomIdentity);
    expect(ctx.fillStyle).toBe(SENTIMENT_COLORS.neutral);
  });

  it("applies zoom transform to position and radius", () => {
    const ctx = mockCtx();
    const node = makeNode({ x: 50, y: 100 });
    const transform = zoomIdentity.scale(2);
    drawNode(ctx, node, 10, transform);

    // Position: graphToScreen(50, 100) with 2x scale = (100, 200)
    // Radius: 10 * 2 = 20
    expect(ctx.arc).toHaveBeenCalledWith(100, 200, 20, 0, Math.PI * 2);
  });

  it("draws dashed border for stub nodes", () => {
    const ctx = mockCtx();
    const node = makeNode({ isStub: true, stubType: "more" });
    drawNode(ctx, node, 8, zoomIdentity);

    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 2]);
    expect(ctx.stroke).toHaveBeenCalled();
    // Verify line dash is reset
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
  });

  it("does not draw dashed border for regular nodes", () => {
    const ctx = mockCtx();
    const node = makeNode({ isStub: false });
    drawNode(ctx, node, 8, zoomIdentity);

    expect(ctx.setLineDash).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

// ── drawEdge ────────────────────────────────────────────────────────

describe("drawEdge", () => {
  it("draws a line between two nodes", () => {
    const ctx = mockCtx();
    const source = makeNode({ x: 0, y: 0 });
    const target = makeNode({ x: 100, y: 200 });
    drawEdge(ctx, source, target, zoomIdentity);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 200);
    expect(ctx.strokeStyle).toBe(EDGE_COLOR);
    expect(ctx.lineWidth).toBe(0.5);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("uses highlight style when highlighted", () => {
    const ctx = mockCtx();
    const source = makeNode({ x: 0, y: 0 });
    const target = makeNode({ x: 100, y: 100 });
    drawEdge(ctx, source, target, zoomIdentity, true);

    expect(ctx.strokeStyle).toBe(EDGE_HOVER_COLOR);
    expect(ctx.lineWidth).toBe(1.5);
  });

  it("applies zoom transform to coordinates", () => {
    const ctx = mockCtx();
    const source = makeNode({ x: 10, y: 20 });
    const target = makeNode({ x: 50, y: 60 });
    const transform = zoomIdentity.scale(2);
    drawEdge(ctx, source, target, transform);

    expect(ctx.moveTo).toHaveBeenCalledWith(20, 40);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 120);
  });
});
