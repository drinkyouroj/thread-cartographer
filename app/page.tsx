"use client";

import { useState, useCallback, useMemo } from "react";
import type { ThreadData, FilterState, CommentNode } from "../lib/types";
import UrlInput from "../components/UrlInput";
import ControlPanel from "../components/ControlPanel";
import ThreadGraph from "../components/ThreadGraph";
import NodeDetail from "../components/NodeDetail";

export default function Home() {
  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [selectedNode, setSelectedNode] = useState<CommentNode | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    maxDepth: 100,
    minScore: -100,
  });

  // Compute max available depth from data for the slider (reduce, not spread)
  const maxAvailableDepth = useMemo(() => {
    if (!threadData) return 0;
    return threadData.nodes.reduce((max, n) => Math.max(max, n.depth), 0);
  }, [threadData]);

  // Compute visible node count for the control panel stats
  const visibleNodes = useMemo(() => {
    if (!threadData) return 0;
    return threadData.nodes.filter(
      (n) => n.depth <= filter.maxDepth && n.score >= filter.minScore
    ).length;
  }, [threadData, filter]);

  // Derive effective selected node — null if filtered out
  const effectiveSelectedNode = useMemo(() => {
    if (!selectedNode) return null;
    const isVisible =
      selectedNode.depth <= filter.maxDepth &&
      selectedNode.score >= filter.minScore;
    return isVisible ? selectedNode : null;
  }, [selectedNode, filter]);

  const handleThreadLoaded = useCallback((data: ThreadData) => {
    setThreadData(data);
    setSelectedNode(null);
    // Set initial filter to show all nodes (reduce, not spread)
    const maxDepth = data.nodes.reduce((max, n) => Math.max(max, n.depth), 0);
    setFilter({ maxDepth, minScore: -100 });
  }, []);

  const handleError = useCallback(() => {
    // Errors are displayed inline by UrlInput — no page-level handling needed
  }, []);

  const handleNodeClick = useCallback((node: CommentNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleDetailClose = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="app-layout">
      <UrlInput onThreadLoaded={handleThreadLoaded} onError={handleError} />
      <div className="app-layout__main">
        <ControlPanel
          filter={filter}
          onFilterChange={setFilter}
          maxAvailableDepth={maxAvailableDepth}
          totalNodes={threadData?.nodes.length ?? 0}
          visibleNodes={visibleNodes}
        />
        <ThreadGraph
          data={threadData}
          filter={filter}
          onNodeClick={handleNodeClick}
          selectedNodeId={effectiveSelectedNode?.id ?? null}
        />
        <NodeDetail node={effectiveSelectedNode} onClose={handleDetailClose} />
      </div>
    </div>
  );
}
