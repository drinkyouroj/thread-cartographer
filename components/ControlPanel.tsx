"use client";

import { useCallback } from "react";
import type { FilterState } from "../lib/types";

interface ControlPanelProps {
  filter: FilterState;
  onFilterChange: (filter: FilterState) => void;
  maxAvailableDepth: number;
  totalNodes: number;
  visibleNodes: number;
}

const SENTIMENT_LEGEND = [
  { label: "Positive", color: "var(--sentiment-positive)", range: "> 0.2" },
  { label: "Neutral", color: "var(--sentiment-neutral)", range: "-0.2 – 0.2" },
  { label: "Negative", color: "var(--sentiment-negative)", range: "< -0.2" },
] as const;

export default function ControlPanel({
  filter,
  onFilterChange,
  maxAvailableDepth,
  totalNodes,
  visibleNodes,
}: ControlPanelProps) {
  const handleDepthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ ...filter, maxDepth: Number(e.target.value) });
    },
    [filter, onFilterChange]
  );

  const handleScoreChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ ...filter, minScore: Number(e.target.value) });
    },
    [filter, onFilterChange]
  );

  return (
    <aside
      className="control-panel"
      role="region"
      aria-label="Graph controls"
    >
      <h2 className="control-panel__title">Controls</h2>

      {/* Depth slider */}
      <div className="control-panel__group">
        <label
          htmlFor="depth-slider"
          className="control-panel__label"
        >
          Max depth: <span className="control-panel__value">{filter.maxDepth}</span>
        </label>
        <input
          id="depth-slider"
          type="range"
          min={0}
          max={maxAvailableDepth}
          step={1}
          value={filter.maxDepth}
          onChange={handleDepthChange}
          className="control-panel__slider"
          aria-valuemin={0}
          aria-valuemax={maxAvailableDepth}
          aria-valuenow={filter.maxDepth}
        />
        <div className="control-panel__range-labels">
          <span>0</span>
          <span>{maxAvailableDepth}</span>
        </div>
      </div>

      {/* Score threshold slider */}
      <div className="control-panel__group">
        <label
          htmlFor="score-slider"
          className="control-panel__label"
        >
          Min score: <span className="control-panel__value">{filter.minScore}</span>
        </label>
        <input
          id="score-slider"
          type="range"
          min={-100}
          max={1000}
          step={1}
          value={filter.minScore}
          onChange={handleScoreChange}
          className="control-panel__slider"
          aria-valuemin={-100}
          aria-valuemax={1000}
          aria-valuenow={filter.minScore}
        />
        <div className="control-panel__range-labels">
          <span>-100</span>
          <span>1000</span>
        </div>
      </div>

      {/* Sentiment color legend */}
      <div className="control-panel__group">
        <span className="control-panel__label">Sentiment</span>
        <ul className="control-panel__legend" role="list" aria-label="Sentiment color legend">
          {SENTIMENT_LEGEND.map(({ label, color, range }) => (
            <li key={label} className="control-panel__legend-item">
              <span
                className="control-panel__swatch"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="control-panel__legend-label">{label}</span>
              <span className="control-panel__legend-range">{range}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Node count summary */}
      <div className="control-panel__stats">
        <span className="control-panel__stat">
          Showing <strong>{visibleNodes}</strong> of {totalNodes} comments
        </span>
      </div>
    </aside>
  );
}
