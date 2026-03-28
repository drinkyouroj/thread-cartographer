"use client";

import { useState, useCallback, useRef } from "react";
import type { ThreadData } from "../lib/types";

type LoadState = "idle" | "loading" | "loaded";

interface UrlInputProps {
  onThreadLoaded: (data: ThreadData) => void;
  onError: (message: string) => void;
}

interface ErrorInfo {
  message: string;
  isWarning: boolean; // orange for rate limit, red for others
}

const REDDIT_URL_PATTERN =
  /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/r\/\w+\/comments\/\w+/i;
const SHORT_URL_PATTERN = /^https?:\/\/redd\.it\//i;

export default function UrlInput({ onThreadLoaded, onError }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [meta, setMeta] = useState<{
    subreddit: string;
    commentCount: number;
    title: string;
    cached: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = url.trim();
      if (!trimmed) return;

      // Client-side validation
      if (SHORT_URL_PATTERN.test(trimmed)) {
        setError({
          message:
            "Please use the full Reddit thread URL, not a redd.it short link.",
          isWarning: false,
        });
        return;
      }

      if (!REDDIT_URL_PATTERN.test(trimmed)) {
        setError({
          message:
            "Please enter a valid Reddit thread URL (reddit.com/r/.../comments/...)",
          isWarning: false,
        });
        return;
      }

      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoadState("loading");

      try {
        // Phase 1: Check cache
        const cacheRes = await fetch(
          `/api/thread?url=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (cacheRes.ok) {
          // Cache hit — data returned directly
          const result = await cacheRes.json();
          handleSuccess(result.data);
          return;
        }

        if (cacheRes.status === 429) {
          let retryAfter = 60;
          try {
            const body = await cacheRes.json();
            retryAfter = body.error?.retryAfter ?? 60;
          } catch (parseErr) {
            console.warn("[UrlInput] Could not parse 429 response:", parseErr);
          }
          setError({
            message: `Too many requests. Please wait ${retryAfter} seconds.`,
            isWarning: true,
          });
          setLoadState("idle");
          onError("Rate limited");
          return;
        }

        if (cacheRes.status === 400) {
          let message = "Invalid URL";
          try {
            const body = await cacheRes.json();
            message = body.error?.message ?? "Invalid URL";
          } catch (parseErr) {
            console.warn("[UrlInput] Could not parse 400 response:", parseErr);
          }
          setError({ message, isWarning: false });
          setLoadState("idle");
          onError(message);
          return;
        }

        if (cacheRes.status !== 404) {
          // Unexpected error from cache check
          throw new Error(`Unexpected response: ${cacheRes.status}`);
        }

        // Phase 2: Cache miss — fetch from Reddit (client-side)
        const cacheBody = await cacheRes.json();
        const fetchUrl = cacheBody.data?.fetchUrl;
        if (!fetchUrl) throw new Error("No fetchUrl in cache miss response");

        const redditRes = await fetch(fetchUrl, {
          signal: controller.signal,
        });

        if (!redditRes.ok) {
          throw new Error(
            `Reddit returned ${redditRes.status}. The thread may be private or unavailable.`
          );
        }

        const redditData = await redditRes.json();

        // Phase 3: Send to server for processing
        const processRes = await fetch("/api/thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, redditData }),
          signal: controller.signal,
        });

        if (!processRes.ok) {
          let msg = "Failed to process thread";
          let retryAfter = 60;
          try {
            const body = await processRes.json();
            msg = body.error?.message ?? msg;
            retryAfter = body.error?.retryAfter ?? 60;
          } catch (parseErr) {
            console.warn("[UrlInput] Could not parse error response:", parseErr);
          }

          if (processRes.status === 429) {
            setError({
              message: `Too many requests. Please wait ${retryAfter} seconds.`,
              isWarning: true,
            });
            setLoadState("idle");
            onError("Rate limited");
            return;
          }

          throw new Error(msg);
        }

        const result = await processRes.json();
        handleSuccess(result.data);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        setError({ message, isWarning: false });
        setLoadState("idle");
        onError(message);
      }
    },
    [url, onThreadLoaded, onError]
  );

  function handleSuccess(data: ThreadData) {
    setLoadState("loaded");
    setMeta({
      subreddit: data.subreddit,
      commentCount: data.commentCount,
      title: data.title,
      cached: false,
    });
    onThreadLoaded(data);
  }

  return (
    <div className="url-input" role="search" aria-label="Thread URL input">
      <form className="url-input__form" onSubmit={handleSubmit}>
        <input
          type="url"
          className="url-input__field"
          placeholder="Paste a Reddit thread URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loadState === "loading"}
          aria-label="Reddit thread URL"
          aria-describedby={error ? "url-error" : undefined}
        />
        <button
          type="submit"
          className="url-input__button"
          disabled={loadState === "loading" || !url.trim()}
        >
          {loadState === "loading" ? "Fetching..." : "Visualize"}
        </button>
      </form>

      {error && (
        <p
          id="url-error"
          className={`url-input__error ${error.isWarning ? "url-input__error--warning" : ""}`}
          role="alert"
        >
          {error.message}
        </p>
      )}

      {meta && loadState === "loaded" && (
        <div className="url-input__meta" aria-label="Thread metadata">
          <span className="url-input__meta-item">
            <span className="url-input__meta-label">r/</span>
            <span className="url-input__meta-value">{meta.subreddit}</span>
          </span>
          <span className="url-input__meta-item">
            <span className="url-input__meta-value">
              {meta.commentCount}
            </span>
            <span className="url-input__meta-label">comments</span>
          </span>
        </div>
      )}
    </div>
  );
}
