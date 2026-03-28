// Graph rendering utilities — node sizing, hit-testing, coordinate transforms, Canvas draw helpers
// Spec: BUILD_PLAN_FULL_v2.md Section 4

import { quadtree } from "d3-quadtree";
import type { ZoomTransform } from "d3-zoom";
import type { SimulationNode } from "./types";

// ── Constants ───────────────────────────────────────────────────────

export const MIN_RADIUS = 4;
export const MAX_RADIUS = 20;

// Sentiment colors — must match theme.css --sentiment-*-node values
export const SENTIMENT_COLORS = {
  positive: "#5aadff",
  neutral: "#8a8a9a",
  negative: "#f08840",
} as const;

export const EDGE_COLOR = "rgba(120, 120, 140, 0.3)";
export const EDGE_HOVER_COLOR = "rgba(180, 180, 200, 0.6)";

// ── Node radius ─────────────────────────────────────────────────────

export function nodeRadius(
  score: number,
  scoreHidden: boolean,
  allScores: number[]
): number {
  // Filter to non-hidden scores for range calculation
  const visibleScores = allScores.filter((_, i) => !scoreHidden || i === -1);
  // If scoreHidden, use the median radius of all non-hidden nodes
  if (scoreHidden) {
    return medianRadius(allScores);
  }

  if (allScores.length === 0) return MIN_RADIUS;

  const minScore = Math.min(...allScores);
  const maxScore = Math.max(...allScores);

  // All scores are the same — return midpoint radius
  if (maxScore === minScore) return (MIN_RADIUS + MAX_RADIUS) / 2;

  const normalized = (score - minScore) / (maxScore - minScore);
  const radius = MIN_RADIUS + normalized * (MAX_RADIUS - MIN_RADIUS);
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}

function medianRadius(allScores: number[]): number {
  if (allScores.length === 0) return (MIN_RADIUS + MAX_RADIUS) / 2;

  const sorted = [...allScores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianScore =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  return nodeRadius(medianScore, false, allScores);
}

// ── Sentiment color ─────────────────────────────────────────────────

export function sentimentColor(sentiment: number): string {
  if (sentiment > 0.2) return SENTIMENT_COLORS.positive;
  if (sentiment < -0.2) return SENTIMENT_COLORS.negative;
  return SENTIMENT_COLORS.neutral;
}

// ── Coordinate transforms ───────────────────────────────────────────

export function screenToGraph(
  screenX: number,
  screenY: number,
  transform: ZoomTransform
): [number, number] {
  const point = transform.invert([screenX, screenY]);
  return [point[0], point[1]];
}

export function graphToScreen(
  graphX: number,
  graphY: number,
  transform: ZoomTransform
): [number, number] {
  const point = transform.apply([graphX, graphY]);
  return [point[0], point[1]];
}

// ── Quadtree hit-testing ────────────────────────────────────────────

export function findNodeAtPoint(
  x: number,
  y: number,
  nodes: SimulationNode[],
  transform: ZoomTransform,
  allScores: number[]
): SimulationNode | null {
  if (nodes.length === 0) return null;

  // Convert screen coordinates to simulation (graph) coordinates
  const [sx, sy] = screenToGraph(x, y, transform);

  // Build quadtree from current positions
  const qt = quadtree<SimulationNode>()
    .x((d) => d.x)
    .y((d) => d.y)
    .addAll(nodes);

  // Search within MAX_RADIUS in graph space (accounting for zoom scale)
  const searchRadius = MAX_RADIUS / transform.k;

  let closest: SimulationNode | null = null;
  let closestDist = Infinity;

  qt.visit((quad, x0, y0, x1, y1) => {
    // Skip this quadrant if too far away
    const nearestX = Math.max(x0, Math.min(sx, x1));
    const nearestY = Math.max(y0, Math.min(sy, y1));
    const dx = sx - nearestX;
    const dy = sy - nearestY;
    if (dx * dx + dy * dy > searchRadius * searchRadius) return true;

    // Check leaf nodes
    if (!("length" in quad)) {
      let q: typeof quad | undefined = quad;
      while (q) {
        const node = q.data;
        const ndx = sx - node.x;
        const ndy = sy - node.y;
        const dist = Math.sqrt(ndx * ndx + ndy * ndy);
        const radius =
          nodeRadius(node.score, node.scoreHidden, allScores) / transform.k;

        if (dist < radius && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
        q = q.next;
      }
    }
    return false;
  });

  return closest;
}

// ── Canvas draw helpers ─────────────────────────────────────────────

export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: SimulationNode,
  radius: number,
  transform: ZoomTransform
): void {
  const [sx, sy] = graphToScreen(node.x, node.y, transform);
  const scaledRadius = radius * transform.k;

  ctx.beginPath();
  ctx.arc(sx, sy, scaledRadius, 0, Math.PI * 2);
  ctx.fillStyle = sentimentColor(node.sentiment);
  ctx.fill();

  // Stub nodes get a dashed border
  if (node.isStub) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  source: SimulationNode,
  target: SimulationNode,
  transform: ZoomTransform,
  highlighted: boolean = false
): void {
  const [sx, sy] = graphToScreen(source.x, source.y, transform);
  const [tx, ty] = graphToScreen(target.x, target.y, transform);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = highlighted ? EDGE_HOVER_COLOR : EDGE_COLOR;
  ctx.lineWidth = highlighted ? 1.5 : 0.5;
  ctx.stroke();
}
