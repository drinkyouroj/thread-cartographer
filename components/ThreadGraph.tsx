"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
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
  findNodeAtPoint,
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
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const tooltipNodeIdRef = useRef<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    node: CommentNode;
    x: number;
    y: number;
  } | null>(null);

  // Store current props in refs so draw() always reads fresh values
  const dataRef = useRef(data);
  const filterRef = useRef(filter);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const onNodeClickRef = useRef(onNodeClick);
  dataRef.current = data;
  filterRef.current = filter;
  selectedNodeIdRef.current = selectedNodeId;
  onNodeClickRef.current = onNodeClick;

  // ── Derive visible nodes from filter (for render decisions) ─────

  const visibleNodes = data
    ? data.nodes.filter(
        (n) => n.depth <= filter.maxDepth && n.score >= filter.minScore
      )
    : [];

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

  // ── Build SimulationNodes from current state (for hit-testing) ──

  function buildNodeMap(): {
    nodeMap: Map<string, SimulationNode>;
    scores: number[];
  } {
    const curData = dataRef.current;
    const curFilter = filterRef.current;
    const positions = positionsRef.current;

    if (!curData) return { nodeMap: new Map(), scores: [] };

    const nodes = curData.nodes.filter(
      (n) => n.depth <= curFilter.maxDepth && n.score >= curFilter.minScore
    );
    const scores = nodes.filter((n) => !n.scoreHidden).map((n) => n.score);

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

    return { nodeMap, scores };
  }

  // ── Canvas draw — reads all state from refs for freshness ───────
  // Coordinate system: d3-zoom operates in top-left origin space.
  // We bake centering into the zoom transform (initial translate to center),
  // NOT via ctx.translate. This keeps d3-zoom, drawing, and hit-testing
  // all in the same coordinate space.

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
    const transform = transformRef.current;

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
    }

    // Reset transform for retina scaling only
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.clearRect(0, 0, width, height);

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
        const sx = simNode.x * transform.k + transform.x;
        const sy = simNode.y * transform.k + transform.y;
        const scaledRadius = radius * transform.k;
        ctx.beginPath();
        ctx.arc(sx, sy, scaledRadius + SELECTED_RING_WIDTH, 0, Math.PI * 2);
        ctx.strokeStyle = SELECTED_RING_COLOR;
        ctx.lineWidth = SELECTED_RING_WIDTH;
        ctx.stroke();
      }
    }
  }, []);

  // Store draw in a ref so Worker onmessage always calls the latest version
  const drawRef = useRef(draw);
  drawRef.current = draw;

  function requestRedraw() {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(() => drawRef.current());
  }

  // ── d3-zoom integration ─────────────────────────────────────────
  // Set initial transform to center the graph in the canvas.
  // d3-zoom operates in top-left origin, so centering = translate(w/2, h/2).

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        // Clear tooltip during zoom to avoid stale position
        if (tooltipNodeIdRef.current) {
          tooltipNodeIdRef.current = null;
          setTooltipState(null);
        }
        requestRedraw();
      });

    const sel = select(canvas);
    sel.call(zoomBehavior);

    // Set initial transform to center graph origin in canvas
    const initialTransform = zoomIdentity.translate(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2
    );
    sel.call(zoomBehavior.transform, initialTransform);
    transformRef.current = initialTransform;

    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  // ── Click handler — hit-test and select node ────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleClick(e: MouseEvent) {
      const cvs = canvasRef.current;
      if (!cvs) return;

      const rect = cvs.getBoundingClientRect();
      // d3-zoom operates in top-left origin — no centering offset needed
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const { nodeMap, scores } = buildNodeMap();
      const nodesArray = Array.from(nodeMap.values());

      const hit = findNodeAtPoint(
        screenX,
        screenY,
        nodesArray,
        transformRef.current,
        scores
      );

      onNodeClickRef.current(hit);
    }

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, []);

  // ── Hover handler — show tooltip on mousemove ───────────────────
  // Optimized: only calls setTooltipState when the hovered node changes

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleMouseMove(e: MouseEvent) {
      const cvs = canvasRef.current;
      if (!cvs) return;

      const rect = cvs.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const { nodeMap, scores } = buildNodeMap();
      const nodesArray = Array.from(nodeMap.values());

      const hit = findNodeAtPoint(
        screenX,
        screenY,
        nodesArray,
        transformRef.current,
        scores
      );

      if (hit) {
        cvs.style.cursor = "pointer";
        // Only trigger React re-render if hovered node changed
        if (tooltipNodeIdRef.current !== hit.id) {
          tooltipNodeIdRef.current = hit.id;
          setTooltipState({
            node: hit,
            x: e.clientX - rect.left + 12,
            y: e.clientY - rect.top - 8,
          });
        } else {
          // Same node — update position in ref without re-render
          // (tooltip stays near where it appeared)
        }
      } else {
        cvs.style.cursor = "grab";
        if (tooltipNodeIdRef.current !== null) {
          tooltipNodeIdRef.current = null;
          setTooltipState(null);
        }
      }
    }

    function handleMouseLeave() {
      if (tooltipNodeIdRef.current !== null) {
        tooltipNodeIdRef.current = null;
        setTooltipState(null);
      }
    }

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  // ── Worker lifecycle ────────────────────────────────────────────

  useEffect(() => {
    if (!data) return;

    setWorkerError(null);

    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/forceLayout.worker.ts", import.meta.url)
      );
    } catch (err) {
      console.error("[ThreadGraph] Failed to create Web Worker:", err);
      setWorkerError("Visualization engine failed to load. Try refreshing.");
      return;
    }
    workerRef.current = worker;

    worker.onerror = (event: ErrorEvent) => {
      console.error("[ThreadGraph] Worker failed:", event.message);
      setIsSimulating(false);
      setWorkerError("Visualization failed to load. Try refreshing.");
    };

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;

      if (msg.type === "TICK" || msg.type === "STABILIZED") {
        const newPositions: PositionMap = {};

        if (msg.nodeIds && msg.positions instanceof Float32Array) {
          for (let i = 0; i < msg.nodeIds.length; i++) {
            newPositions[msg.nodeIds[i]] = {
              x: msg.positions[i * 2],
              y: msg.positions[i * 2 + 1],
            };
          }
        } else if (Array.isArray(msg.positions)) {
          for (const pos of msg.positions) {
            newPositions[pos.id] = { x: pos.x, y: pos.y };
          }
        }

        positionsRef.current = { ...positionsRef.current, ...newPositions };

        if (msg.type === "STABILIZED") {
          setIsSimulating(false);
        }

        requestRedraw();
      }

      if (msg.type === "ERROR") {
        console.error("[ThreadGraph Worker]", msg.message, msg.stack);
        setIsSimulating(false);
        setWorkerError("Graph layout failed. Try refreshing.");
      }
    };

    // Send INIT with ALL nodes/edges — Worker simulates the full graph.
    // Visibility filtering is handled by FILTER messages and draw().
    setIsSimulating(true);
    worker.postMessage({
      type: "INIT",
      nodes: data.nodes.map((n) => ({ id: n.id })),
      edges: data.edges.map((e) => ({ source: e.source, target: e.target })),
    });

    return () => {
      worker.postMessage({ type: "STOP" });
      worker.terminate();
      workerRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.threadId]);

  // ── Send FILTER to worker on filter changes ─────────────────────

  useEffect(() => {
    if (!workerRef.current || !data) return;

    workerRef.current.postMessage({
      type: "FILTER",
      visibleNodeIds: Array.from(visibleNodeIds),
    });

    requestRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.maxDepth, filter.minScore]);

  // ── Redraw on selection change ──────────────────────────────────

  useEffect(() => {
    requestRedraw();
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

  if (workerError) {
    return (
      <div className="thread-graph thread-graph--empty">
        <p className="thread-graph__placeholder">{workerError}</p>
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
      {tooltipState && (
        <div
          className="graph-tooltip"
          style={{ left: tooltipState.x, top: tooltipState.y }}
        >
          <div className="graph-tooltip__author">u/{tooltipState.node.author}</div>
          <div className="graph-tooltip__meta">
            {tooltipState.node.scoreHidden
              ? "score hidden"
              : `${tooltipState.node.score} points`}
            {" · "}
            depth {tooltipState.node.depth}
          </div>
        </div>
      )}
    </div>
  );
}
