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

  // Compute max available depth from data for the slider
  const maxAvailableDepth = useMemo(() => {
    if (!threadData) return 0;
    return Math.max(0, ...threadData.nodes.map((n) => n.depth));
  }, [threadData]);

  // Compute visible node count for the control panel stats
  const visibleNodes = useMemo(() => {
    if (!threadData) return 0;
    return threadData.nodes.filter(
      (n) => n.depth <= filter.maxDepth && n.score >= filter.minScore
    ).length;
  }, [threadData, filter]);

  const handleThreadLoaded = useCallback(
    (data: ThreadData) => {
      setThreadData(data);
      setSelectedNode(null);
      // Set initial filter to show all nodes
      const maxDepth = Math.max(0, ...data.nodes.map((n) => n.depth));
      setFilter({ maxDepth, minScore: -100 });
    },
    []
  );

  const handleError = useCallback(() => {
    // Errors are displayed inline by UrlInput — no page-level handling needed
  }, []);

  const handleNodeClick = useCallback(
    (node: CommentNode | null) => {
      setSelectedNode(node);
    },
    []
  );

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
          selectedNodeId={selectedNode?.id ?? null}
        />
        <NodeDetail node={selectedNode} onClose={handleDetailClose} />
      </div>
    </div>
  );
}
