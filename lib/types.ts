// Core data types for Thread Cartographer
// Per PRD Section 4.4 — all consumers depend on these types

export interface CommentNode {
  id: string;
  author: string;
  body: string; // raw markdown (used for sentiment scoring)
  bodyHtml: string; // rendered + sanitized HTML (displayed in detail panel)
  score: number;
  scoreHidden: boolean;
  depth: number;
  parentId: string | null;
  permalink: string;
  createdUtc: number;
  isStub: boolean; // true for "load more" placeholders
  stubType?: "more" | "continue"; // "more" = breadth truncation, "continue" = depth truncation
  childCount?: number; // for stubs: how many children are hidden
  sentiment: number; // normalized [-1, 1] from AFINN scoring
}

export interface ThreadEdge {
  source: string; // parent comment ID
  target: string; // child comment ID
}

export interface ThreadData {
  threadId: string;
  title: string;
  subreddit: string;
  author: string;
  url: string;
  score: number;
  commentCount: number; // total comments per Reddit metadata
  nodes: CommentNode[];
  edges: ThreadEdge[];
  fetchedAt: number; // Unix timestamp (ms)
  isTruncated: boolean; // true if 500-cap was applied
  sanitized: boolean; // false if sanitization deferred to client
}

export interface FilterState {
  maxDepth: number;
  minScore: number;
}

// Web Worker message types
export interface WorkerInitMessage {
  type: "INIT";
  nodes: Array<{ id: string; x?: number; y?: number }>;
  edges: Array<{ source: string; target: string }>;
}

export interface WorkerFilterMessage {
  type: "FILTER";
  visibleNodeIds: string[];
}

export interface WorkerStopMessage {
  type: "STOP";
}

export type WorkerInboundMessage =
  | WorkerInitMessage
  | WorkerFilterMessage
  | WorkerStopMessage;

export interface WorkerTickMessage {
  type: "TICK";
  positions: Float32Array | Array<{ id: string; x: number; y: number }>;
  nodeIds?: string[]; // required when positions is Float32Array (maps index → node ID)
  alpha: number;
}

export interface WorkerStabilizedMessage {
  type: "STABILIZED";
  positions: Float32Array | Array<{ id: string; x: number; y: number }>;
  nodeIds?: string[]; // required when positions is Float32Array (maps index → node ID)
}

export interface WorkerErrorMessage {
  type: "ERROR";
  message: string;
  stack?: string;
}

export type WorkerOutboundMessage =
  | WorkerTickMessage
  | WorkerStabilizedMessage
  | WorkerErrorMessage;

// API response wrapper
export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    retryAfter?: number;
  };
  meta?: {
    cached: boolean;
    fetchedAt: number;
    degraded: boolean;
  };
}

// D3 simulation node (extends CommentNode with position)
export interface SimulationNode extends CommentNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}
