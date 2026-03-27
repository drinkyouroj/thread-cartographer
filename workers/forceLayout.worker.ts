// Web Worker for D3 force simulation — runs off-main-thread
// Receives INIT/FILTER/STOP, posts TICK/STABILIZED/ERROR
// Uses Float32Array transfers for >200 nodes to avoid structured clone overhead

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

import type {
  WorkerInboundMessage,
  WorkerTickMessage,
  WorkerStabilizedMessage,
  WorkerErrorMessage,
} from "../lib/types";

// ── Internal types ──────────────────────────────────────────────────

interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

// ── State ───────────────────────────────────────────────────────────

let simulation: Simulation<SimNode, SimLink> | null = null;
let nodes: SimNode[] = [];
let nodeIndexById: Map<string, number> = new Map();
let visibleNodeIds: Set<string> | null = null; // null = all visible
let tickCount = 0;

// ── Constants ───────────────────────────────────────────────────────

const TICK_BROADCAST_INTERVAL = 3; // send positions every N ticks
const FLOAT32_THRESHOLD = 200; // use Float32Array above this node count
const ALPHA_MIN = 0.001; // simulation stops at this alpha

// ── Position encoding ───────────────────────────────────────────────

function encodePositionsFloat32(
  nodeList: SimNode[]
): { buffer: Float32Array; transfer: ArrayBuffer } {
  // Layout: [x0, y0, x1, y1, ...] — caller must know node order matches init order
  const buffer = new Float32Array(nodeList.length * 2);
  for (let i = 0; i < nodeList.length; i++) {
    buffer[i * 2] = nodeList[i].x;
    buffer[i * 2 + 1] = nodeList[i].y;
  }
  return { buffer, transfer: buffer.buffer };
}

function encodePositionsJSON(
  nodeList: SimNode[]
): Array<{ id: string; x: number; y: number }> {
  return nodeList.map((n) => ({ id: n.id, x: n.x, y: n.y }));
}

function broadcastPositions(alpha: number, type: "TICK" | "STABILIZED") {
  const activeNodes = visibleNodeIds
    ? nodes.filter((n) => visibleNodeIds!.has(n.id))
    : nodes;

  if (activeNodes.length > FLOAT32_THRESHOLD) {
    const { buffer, transfer } = encodePositionsFloat32(activeNodes);
    const msg: WorkerTickMessage | WorkerStabilizedMessage = {
      type,
      positions: buffer,
      ...(type === "TICK" ? { alpha } : {}),
    } as WorkerTickMessage | WorkerStabilizedMessage;
    // Worker postMessage with transferable ArrayBuffer
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, {
      transfer: [transfer],
    });
  } else {
    const msg: WorkerTickMessage | WorkerStabilizedMessage = {
      type,
      positions: encodePositionsJSON(activeNodes),
      ...(type === "TICK" ? { alpha } : {}),
    } as WorkerTickMessage | WorkerStabilizedMessage;
    self.postMessage(msg);
  }
}

// ── Simulation setup ────────────────────────────────────────────────

function initSimulation(
  initNodes: Array<{ id: string; x?: number; y?: number }>,
  initEdges: Array<{ source: string; target: string }>
) {
  // Tear down any existing simulation
  if (simulation) {
    simulation.stop();
    simulation = null;
  }

  tickCount = 0;
  visibleNodeIds = null;

  // Create SimNodes with initial positions (random scatter if not provided)
  nodes = initNodes.map((n, i) => ({
    id: n.id,
    x: n.x ?? Math.cos((i / initNodes.length) * Math.PI * 2) * 100,
    y: n.y ?? Math.sin((i / initNodes.length) * Math.PI * 2) * 100,
    vx: 0,
    vy: 0,
  }));

  // Build index for fast lookup
  nodeIndexById = new Map(nodes.map((n, i) => [n.id, i]));

  // Filter edges to only include those connecting known nodes
  const validEdges: SimLink[] = initEdges.filter(
    (e) => nodeIndexById.has(e.source) && nodeIndexById.has(e.target)
  );

  simulation = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(validEdges)
        .id((d) => d.id)
        .distance(40)
        .strength(0.7)
    )
    .force("charge", forceManyBody().strength(-120).distanceMax(300))
    .force("center", forceCenter(0, 0).strength(0.05))
    .force("collide", forceCollide<SimNode>().radius(8).strength(0.5))
    .alphaMin(ALPHA_MIN)
    .alphaDecay(0.02)
    .on("tick", onTick)
    .on("end", onEnd);
}

function onTick() {
  tickCount++;
  if (tickCount % TICK_BROADCAST_INTERVAL === 0) {
    broadcastPositions(simulation?.alpha() ?? 0, "TICK");
  }
}

function onEnd() {
  broadcastPositions(0, "STABILIZED");
}

// ── Filter handling ─────────────────────────────────────────────────

function applyFilter(ids: string[]) {
  visibleNodeIds = new Set(ids);

  if (!simulation) return;

  // Reheat simulation so filtered graph re-settles
  simulation.alpha(0.3).restart();
}

// ── Message handler ─────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "INIT":
        initSimulation(msg.nodes, msg.edges);
        break;

      case "FILTER":
        applyFilter(msg.visibleNodeIds);
        break;

      case "STOP":
        if (simulation) {
          simulation.stop();
          simulation = null;
        }
        break;

      default:
        postError(`Unknown message type: ${(msg as { type: string }).type}`);
    }
  } catch (err) {
    postError(err instanceof Error ? err.message : String(err));
  }
};

function postError(message: string) {
  const msg: WorkerErrorMessage = { type: "ERROR", message };
  self.postMessage(msg);
}
