"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { zoomIdentity, type ZoomTransform } from "d3-zoom";
import type {
  CommentNode,
  ThreadData,
  FilterState,
  SimulationNode,
  WorkerOutboundMessage,
} from "../lib/types";
import {
  nodeRadius,
  drawNode,
  drawEdge,
} from "../lib/graphUtils";

// ── Types ───────────────────────────────────────────────────────────

interface ThreadGraphProps {
  data: ThreadData | null;
  filter: FilterState;
  onNodeClick: (node: CommentNode | null) => void;
  selectedNodeId: string | null;
}

interface PositionMap {
  [nodeId: string]: { x: number; y: number };
}

// ── Constants ───────────────────────────────────────────────────────

const SELECTED_RING_COLOR = "rgba(255, 255, 255, 0.8)";
const SELECTED_RING_WIDTH = 2;

// ── Component ───────────────────────────────────────────────────────

export default function ThreadGraph({
  data,
  filter,
  onNodeClick,
  selectedNodeId,
}: ThreadGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<PositionMap>({});
  const animFrameRef = useRef<number>(0);
  const [transform] = useState<ZoomTransform>(() => zoomIdentity);
  const [isSimulating, setIsSimulating] = useState(false);

  // Store current props in refs so draw() always reads fresh values
  const dataRef = useRef(data);
  const filterRef = useRef(filter);
  const selectedNodeIdRef = useRef(selectedNodeId);
  dataRef.current = data;
  filterRef.current = filter;
  selectedNodeIdRef.current = selectedNodeId;

  // ── Derive visible nodes from filter (for render logic) ─────────

  const visibleNodes = data
    ? data.nodes.filter(
        (n) => n.depth <= filter.maxDepth && n.score >= filter.minScore
      )
    : [];

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

  const visibleEdges = data
    ? data.edges.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
      )
    : [];

  // ── Canvas draw — reads all state from refs for freshness ───────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("[ThreadGraph] Failed to acquire 2D canvas context");
      return;
    }

    const curData = dataRef.current;
    const curFilter = filterRef.current;
    const curSelectedId = selectedNodeIdRef.current;
    const positions = positionsRef.current;

    if (!curData) return;

    // Derive visible nodes/edges from current refs
    const nodes = curData.nodes.filter(
      (n) => n.depth <= curFilter.maxDepth && n.score >= curFilter.minScore
    );
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edges = curData.edges.filter(
      (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    );
    const scores = nodes.filter((n) => !n.scoreHidden).map((n) => n.score);

    // Build SimulationNode map with current positions
    const nodeMap = new Map<string, SimulationNode>();
    for (const node of nodes) {
      const pos = positions[node.id];
      nodeMap.set(node.id, {
        ...node,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        vx: 0,
        vy: 0,
      });
    }

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Size canvas for retina
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    }

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Center the coordinate system
    ctx.save();
    ctx.translate(width / 2, height / 2);

    // Draw edges first (behind nodes)
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (source && target) {
        drawEdge(ctx, source, target, transform);
      }
    }

    // Draw nodes
    for (const [id, simNode] of nodeMap) {
      const radius = nodeRadius(simNode.score, simNode.scoreHidden, scores);
      drawNode(ctx, simNode, radius, transform);

      // Selection ring
      if (id === curSelectedId) {
        const [sx, sy] = [simNode.x * transform.k, simNode.y * transform.k];
        const scaledRadius = radius * transform.k;
        ctx.beginPath();
        ctx.arc(
          sx + transform.x,
          sy + transform.y,
          scaledRadius + SELECTED_RING_WIDTH,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = SELECTED_RING_COLOR;
        ctx.lineWidth = SELECTED_RING_WIDTH;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [transform]);

  // Store draw in a ref so Worker onmessage always calls the latest version
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // ── Worker lifecycle ────────────────────────────────────────────

  useEffect(() => {
    if (!data || visibleNodes.length === 0) return;

    // Create worker
    const worker = new Worker(
      new URL("../workers/forceLayout.worker.ts", import.meta.url)
    );
    workerRef.current = worker;

    worker.onerror = (event: ErrorEvent) => {
      console.error(
        "[ThreadGraph] Worker failed:",
        event.message
      );
      setIsSimulating(false);
    };

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;

      if (msg.type === "TICK" || msg.type === "STABILIZED") {
        const newPositions: PositionMap = {};

        if (msg.nodeIds && msg.positions instanceof Float32Array) {
          // Float32Array path with nodeIds mapping
          for (let i = 0; i < msg.nodeIds.length; i++) {
            newPositions[msg.nodeIds[i]] = {
              x: msg.positions[i * 2],
              y: msg.positions[i * 2 + 1],
            };
          }
        } else if (Array.isArray(msg.positions)) {
          // JSON path
          for (const pos of msg.positions) {
            newPositions[pos.id] = { x: pos.x, y: pos.y };
          }
        }

        positionsRef.current = { ...positionsRef.current, ...newPositions };

        if (msg.type === "STABILIZED") {
          setIsSimulating(false);
        }

        // Request redraw using ref to get latest draw function
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(() => drawRef.current());
      }

      if (msg.type === "ERROR") {
        console.error("[ThreadGraph Worker]", msg.message, msg.stack);
        setIsSimulating(false);
      }
    };

    // Send INIT
    setIsSimulating(true);
    worker.postMessage({
      type: "INIT",
      nodes: visibleNodes.map((n) => ({ id: n.id })),
      edges: visibleEdges.map((e) => ({ source: e.source, target: e.target })),
    });

    return () => {
      worker.postMessage({ type: "STOP" });
      worker.terminate();
      workerRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
    };
    // Only re-init worker when data changes, not on every filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.threadId]);

  // ── Send FILTER to worker on filter changes ─────────────────────

  useEffect(() => {
    if (!workerRef.current || !data) return;

    workerRef.current.postMessage({
      type: "FILTER",
      visibleNodeIds: Array.from(visibleNodeIds),
    });

    // Redraw with current positions (filter may hide/show nodes)
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(() => drawRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.maxDepth, filter.minScore]);

  // ── Redraw on selection change ──────────────────────────────────

  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(() => drawRef.current());
  }, [selectedNodeId]);

  // ── Empty state ─────────────────────────────────────────────────

  if (!data) {
    return (
      <div className="thread-graph thread-graph--empty">
        <p className="thread-graph__placeholder">
          Paste a Reddit thread URL to visualize its comment structure
        </p>
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <div className="thread-graph thread-graph--empty">
        <p className="thread-graph__placeholder">
          No comments match the current filters. Try adjusting depth or score
          thresholds.
        </p>
      </div>
    );
  }

  return (
    <div className="thread-graph" style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="thread-graph__canvas"
        aria-label={`Force-directed graph showing ${visibleNodes.length} comments`}
        role="img"
      />
      {isSimulating && (
        <div className="thread-graph__status">Laying out graph...</div>
      )}
    </div>
  );
}
