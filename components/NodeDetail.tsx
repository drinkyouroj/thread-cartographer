"use client";

import { useEffect, useRef, useCallback } from "react";
import type { CommentNode } from "../lib/types";

interface NodeDetailProps {
  node: CommentNode | null;
  onClose: () => void;
}

function sentimentLabel(sentiment: number): string {
  if (sentiment > 0.2) return "Positive";
  if (sentiment < -0.2) return "Negative";
  return "Neutral";
}

function sentimentColor(sentiment: number): string {
  if (sentiment > 0.2) return "var(--sentiment-positive)";
  if (sentiment < -0.2) return "var(--sentiment-negative)";
  return "var(--sentiment-neutral)";
}

export default function NodeDetail({ node, onClose }: NodeDetailProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isOpen = node !== null;

  // Focus the close button when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow CSS transition to start
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Focus trap: Tab cycles within the panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, a[href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  return (
    <aside
      ref={panelRef}
      className={`node-detail ${isOpen ? "node-detail--open" : ""}`}
      role="complementary"
      aria-label="Comment detail"
      aria-hidden={!isOpen}
      onKeyDown={handleKeyDown}
    >
      {node && (
        <>
          {/* Header */}
          <div className="node-detail__header">
            <span className="node-detail__author">u/{node.author}</span>
            <button
              ref={closeButtonRef}
              className="node-detail__close"
              onClick={onClose}
              aria-label="Close detail panel"
              tabIndex={isOpen ? 0 : -1}
            >
              &times;
            </button>
          </div>

          {/* Metadata */}
          <div className="node-detail__meta">
            <div className="node-detail__meta-item">
              <span className="node-detail__meta-label">Score</span>
              <span className="node-detail__meta-value">
                {node.scoreHidden ? "hidden" : node.score}
              </span>
            </div>
            <div className="node-detail__meta-item">
              <span className="node-detail__meta-label">Depth</span>
              <span className="node-detail__meta-value">{node.depth}</span>
            </div>
            <div className="node-detail__meta-item">
              <span className="node-detail__meta-label">Sentiment</span>
              <span
                className="node-detail__meta-value"
                style={{ color: sentimentColor(node.sentiment) }}
              >
                {sentimentLabel(node.sentiment)}
              </span>
            </div>
          </div>

          {/* Comment body — bodyHtml is pre-sanitized server-side via sanitize-html
              in lib/sanitize.ts before being stored in ThreadData. Raw Reddit HTML
              never reaches this component. See lib/redditParser.ts → sanitizeHtml(). */}
          <div className="node-detail__body">
            {node.isStub ? (
              <p className="node-detail__stub-notice">
                {node.stubType === "more"
                  ? `${node.childCount ?? 0} more comments not loaded`
                  : "Continue this thread on Reddit"}
              </p>
            ) : (
              <div
                className="node-detail__comment-html"
                dangerouslySetInnerHTML={{ __html: node.bodyHtml }}
              />
            )}
          </div>

          {/* Permalink */}
          {node.permalink && (
            <a
              className="node-detail__permalink"
              href={`https://reddit.com${node.permalink}`}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={isOpen ? 0 : -1}
            >
              View on Reddit &rarr;
            </a>
          )}
        </>
      )}
    </aside>
  );
}
