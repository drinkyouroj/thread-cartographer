import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock self.postMessage for Worker context
const postMessageSpy = vi.fn();

// Set up Worker globals before importing the worker module
vi.stubGlobal("self", {
  onmessage: null as ((event: MessageEvent) => void) | null,
  postMessage: postMessageSpy,
});

// Import worker after globals are set up — side effect registers self.onmessage
await import("@/workers/forceLayout.worker");

function sendMessage(data: unknown) {
  const handler = (self as unknown as { onmessage: (e: MessageEvent) => void })
    .onmessage;
  handler({ data } as MessageEvent);
}

describe("forceLayout.worker", () => {
  beforeEach(() => {
    postMessageSpy.mockClear();
    // Stop any running simulation from previous test
    sendMessage({ type: "STOP" });
    postMessageSpy.mockClear();
  });

  describe("INIT message", () => {
    it("accepts INIT and starts posting TICK messages", async () => {
      sendMessage({
        type: "INIT",
        nodes: [
          { id: "a" },
          { id: "b" },
          { id: "c" },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
      });

      // Wait for simulation ticks to fire
      await new Promise((r) => setTimeout(r, 300));

      // Should have received at least one TICK or STABILIZED message
      expect(postMessageSpy.mock.calls.length).toBeGreaterThan(0);

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const types = messages.map((m: { type: string }) => m.type);
      expect(types.some((t: string) => t === "TICK" || t === "STABILIZED")).toBe(true);
    });

    it("sends positions with correct structure for small node sets (JSON)", async () => {
      sendMessage({
        type: "INIT",
        nodes: [{ id: "x" }, { id: "y" }],
        edges: [{ source: "x", target: "y" }],
      });

      await new Promise((r) => setTimeout(r, 300));

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const tickOrStabilized = messages.find(
        (m: { type: string }) => m.type === "TICK" || m.type === "STABILIZED"
      );
      expect(tickOrStabilized).toBeDefined();

      // Small node set (< 200) should use JSON positions
      const positions = tickOrStabilized.positions;
      expect(Array.isArray(positions)).toBe(true);
      if (Array.isArray(positions) && positions.length > 0) {
        expect(positions[0]).toHaveProperty("id");
        expect(positions[0]).toHaveProperty("x");
        expect(positions[0]).toHaveProperty("y");
      }
    });

    it("filters edges with unknown node IDs", async () => {
      // Edge references node "z" which doesn't exist — should not crash
      sendMessage({
        type: "INIT",
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [
          { source: "a", target: "b" },
          { source: "a", target: "z" }, // invalid
        ],
      });

      await new Promise((r) => setTimeout(r, 200));

      // Should not have posted an ERROR
      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const errors = messages.filter((m: { type: string }) => m.type === "ERROR");
      expect(errors).toHaveLength(0);
    });

    it("uses Float32Array with nodeIds for large node sets (>200)", async () => {
      // Generate 210 nodes (above FLOAT32_THRESHOLD of 200)
      const nodes = Array.from({ length: 210 }, (_, i) => ({ id: `n${i}` }));
      const edges = Array.from({ length: 209 }, (_, i) => ({
        source: `n${i}`,
        target: `n${i + 1}`,
      }));

      sendMessage({ type: "INIT", nodes, edges });

      // Wait for simulation ticks
      await new Promise((r) => setTimeout(r, 500));

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const tickOrStabilized = messages.find(
        (m: { type: string }) => m.type === "TICK" || m.type === "STABILIZED"
      );
      expect(tickOrStabilized).toBeDefined();

      // Should use Float32Array (not JSON array) for >200 nodes
      expect(tickOrStabilized.positions).toBeInstanceOf(Float32Array);
      expect(tickOrStabilized.positions.length).toBe(210 * 2); // x,y pairs

      // Must include nodeIds for the receiver to map positions back to nodes
      expect(tickOrStabilized.nodeIds).toBeDefined();
      expect(Array.isArray(tickOrStabilized.nodeIds)).toBe(true);
      expect(tickOrStabilized.nodeIds.length).toBe(210);
      expect(tickOrStabilized.nodeIds[0]).toBe("n0");
    });
  });

  describe("STOP message", () => {
    it("stops the simulation without error", () => {
      sendMessage({
        type: "INIT",
        nodes: [{ id: "a" }],
        edges: [],
      });

      sendMessage({ type: "STOP" });

      // No ERROR should be posted
      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const errors = messages.filter((m: { type: string }) => m.type === "ERROR");
      expect(errors).toHaveLength(0);
    });

    it("handles STOP when no simulation is running", () => {
      sendMessage({ type: "STOP" });

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const errors = messages.filter((m: { type: string }) => m.type === "ERROR");
      expect(errors).toHaveLength(0);
    });
  });

  describe("FILTER message", () => {
    it("accepts FILTER and reheats simulation", async () => {
      sendMessage({
        type: "INIT",
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
      });

      // Let simulation settle a bit
      await new Promise((r) => setTimeout(r, 200));
      postMessageSpy.mockClear();

      sendMessage({
        type: "FILTER",
        visibleNodeIds: ["a", "b"],
      });

      // Should reheat and produce new ticks
      await new Promise((r) => setTimeout(r, 300));
      expect(postMessageSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it("handles FILTER before INIT without error", () => {
      sendMessage({
        type: "FILTER",
        visibleNodeIds: ["a", "b"],
      });

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const errors = messages.filter((m: { type: string }) => m.type === "ERROR");
      expect(errors).toHaveLength(0);

      // Should not produce any TICK messages (no simulation running)
      const ticks = messages.filter((m: { type: string }) => m.type === "TICK");
      expect(ticks).toHaveLength(0);
    });
  });

  describe("unknown message type", () => {
    it("posts ERROR for unknown message type", () => {
      sendMessage({ type: "UNKNOWN_TYPE" });

      const messages = postMessageSpy.mock.calls.map((c) => c[0]);
      const errors = messages.filter((m: { type: string }) => m.type === "ERROR");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("Unknown message type");
    });
  });
});
