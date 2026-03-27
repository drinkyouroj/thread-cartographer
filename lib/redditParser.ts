// Parse Reddit's nested JSON response into flat CommentNode[] + ThreadEdge[]
// Handles all Reddit gotchas from BUILD_PLAN_FULL_v2 Section 8

import type { CommentNode, ThreadEdge, ThreadData } from "./types";
import { scoreSentiment } from "./sentiment";
import { sanitizeHtml, decodeHtmlEntities } from "./sanitize";

const MAX_COMMENT_NODES = 500;

/** Strip t1_/t3_ prefix from Reddit IDs (Gotcha #2) */
function stripIdPrefix(id: string): string {
  return id.replace(/^t[0-9]_/, "");
}

/**
 * Normalize a Reddit URL to always fetch the full thread.
 * Strips comment permalink deep-links (Gotcha #10), query params,
 * hash, trailing slashes, and .json suffix.
 */
export function normalizeRedditUrl(url: string): string {
  let clean = url.split("?")[0].split("#")[0];
  clean = clean.replace(/\/+$/, "").replace(/\.json$/, "").replace(/\/+$/, "");

  // Strip comment ID from permalink URLs
  // Pattern: /r/{sub}/comments/{threadId}/{slug}/{commentId}
  // We want: /r/{sub}/comments/{threadId}/
  const match = clean.match(/(\/r\/[^/]+\/comments\/[a-z0-9]+)/i);
  if (match) {
    clean = clean.replace(match[0], match[1]);
    // Remove anything after the thread ID (slug and comment ID)
    const afterThread = clean.substring(match.index! + match[1].length);
    if (afterThread) {
      clean = clean.substring(0, match.index! + match[1].length);
    }
  }

  return clean;
}

/**
 * Validate that the input looks like a Reddit .json API response.
 * Returns null if valid, or an error message if not.
 */
export function validateRedditJson(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return "Expected an array (Reddit returns [post, comments])";
  }
  if (data.length < 2) {
    return "Expected at least 2 elements in the array";
  }
  const postListing = data[0];
  if (!postListing?.data?.children?.length) {
    return "Missing post data in first listing";
  }
  const post = postListing.data.children[0];
  if (post?.kind !== "t3") {
    return "First child is not a post (expected kind: t3)";
  }
  return null;
}

interface ParseResult {
  nodes: CommentNode[];
  edges: ThreadEdge[];
  isTruncated: boolean;
}

/**
 * Recursively walk the Reddit comment tree and collect nodes + edges.
 * Stops collecting after MAX_COMMENT_NODES.
 */
function walkComments(
  children: Array<Record<string, unknown>>,
  parentId: string,
  depth: number,
  nodes: CommentNode[],
  edges: ThreadEdge[],
  maxDepthIfTruncating: number,
  isTruncating: boolean,
): void {
  for (const child of children) {
    if (nodes.length >= MAX_COMMENT_NODES) return;

    const kind = child.kind as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = child.data as any;
    if (!d) continue;

    if (kind === "more") {
      // Gotcha #4: "more" objects come in two flavors
      const childIds: string[] = d.children ?? [];
      const count: number = d.count ?? 0;
      const moreId = d.id === "_" ? `more_continue_${parentId}` : `more_${d.id ?? parentId}`;
      const isDepthTruncation = d.id === "_" && childIds.length === 0 && count === 0;

      nodes.push({
        id: moreId,
        author: "",
        body: "",
        bodyHtml: "",
        score: 0,
        scoreHidden: false,
        depth,
        parentId,
        permalink: "",
        createdUtc: 0,
        isStub: true,
        stubType: isDepthTruncation ? "continue" : "more",
        childCount: isDepthTruncation ? undefined : count,
        sentiment: 0,
      });

      edges.push({ source: parentId, target: moreId });
      continue;
    }

    if (kind !== "t1") continue;

    const id = stripIdPrefix(d.name ?? d.id ?? "");
    if (!id) continue;

    // Gotcha #8: score_hidden means score is always 1
    const scoreHidden = d.score_hidden === true;

    // If we're truncating (>500 cap), only include top-level + 2 levels
    if (isTruncating && depth > maxDepthIfTruncating) {
      // Create a stub for this branch
      nodes.push({
        id: `truncated_${id}`,
        author: "",
        body: "",
        bodyHtml: "",
        score: 0,
        scoreHidden: false,
        depth,
        parentId,
        permalink: "",
        createdUtc: 0,
        isStub: true,
        stubType: "more",
        childCount: 1,
        sentiment: 0,
      });
      edges.push({ source: parentId, target: `truncated_${id}` });
      continue;
    }

    // Decode and sanitize body_html (Gotcha #3: double-encoded)
    const rawBodyHtml = typeof d.body_html === "string" ? d.body_html : "";
    const bodyHtml = sanitizeHtml(rawBodyHtml);

    const body = typeof d.body === "string" ? d.body : "";
    const sentiment = body ? scoreSentiment(body) : 0;

    const node: CommentNode = {
      id,
      author: d.author ?? "[deleted]",
      body,
      bodyHtml,
      score: typeof d.score === "number" ? d.score : 0,
      scoreHidden,
      depth,
      parentId,
      permalink: typeof d.permalink === "string" ? d.permalink : "",
      createdUtc: typeof d.created_utc === "number" ? d.created_utc : 0,
      isStub: false,
      sentiment,
    };

    nodes.push(node);
    edges.push({ source: parentId, target: id });

    // Gotcha #1: replies can be an empty string, not null
    if (d.replies && typeof d.replies === "object") {
      const replyChildren = d.replies?.data?.children;
      if (Array.isArray(replyChildren)) {
        walkComments(
          replyChildren,
          id,
          depth + 1,
          nodes,
          edges,
          maxDepthIfTruncating,
          isTruncating,
        );
      }
    }
  }
}

/**
 * Count total comments in the raw Reddit response (for truncation decision).
 */
function countRawComments(children: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const child of children) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = child.data as any;
    if (!d) continue;
    if (child.kind === "t1") {
      count++;
      if (d.replies && typeof d.replies === "object") {
        const replyChildren = d.replies?.data?.children;
        if (Array.isArray(replyChildren)) {
          count += countRawComments(replyChildren);
        }
      }
    }
  }
  return count;
}

/**
 * Parse a raw Reddit JSON response into ThreadData.
 * The input should be the JSON-parsed response from {url}.json.
 */
export function parseRedditResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawData: any,
): ThreadData {
  const validationError = validateRedditJson(rawData);
  if (validationError) {
    throw new Error(`Invalid Reddit JSON: ${validationError}`);
  }

  // Extract post data
  const postData = rawData[0].data.children[0].data;
  const threadId = stripIdPrefix(postData.name ?? postData.id ?? "");
  const commentChildren: Array<Record<string, unknown>> =
    rawData[1]?.data?.children ?? [];

  // Decide if we need to truncate
  const rawCommentCount = countRawComments(commentChildren);
  const isTruncating = rawCommentCount > MAX_COMMENT_NODES;

  // Build the root post node
  const rootNode: CommentNode = {
    id: threadId,
    author: postData.author ?? "[deleted]",
    body: postData.selftext ?? "",
    bodyHtml: postData.selftext_html
      ? sanitizeHtml(postData.selftext_html)
      : "",
    score: typeof postData.score === "number" ? postData.score : 0,
    scoreHidden: false,
    depth: 0,
    parentId: null,
    permalink: typeof postData.permalink === "string" ? postData.permalink : "",
    createdUtc:
      typeof postData.created_utc === "number" ? postData.created_utc : 0,
    isStub: false,
    sentiment: postData.selftext ? scoreSentiment(postData.selftext) : 0,
  };

  const nodes: CommentNode[] = [rootNode];
  const edges: ThreadEdge[] = [];

  // Walk the comment tree
  walkComments(
    commentChildren,
    threadId,
    1, // comments start at depth 1
    nodes,
    edges,
    isTruncating ? 2 : Infinity, // if truncating, allow top-level + 2 levels
    isTruncating,
  );

  // Handle orphan references (Gotcha #7)
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      // Reparent to root
      edge.source = threadId;
    }
  }

  return {
    threadId,
    title: typeof postData.title === "string" ? postData.title : "",
    subreddit:
      typeof postData.subreddit === "string" ? postData.subreddit : "",
    author: rootNode.author,
    url: typeof postData.url === "string" ? postData.url : "",
    score: rootNode.score,
    commentCount:
      typeof postData.num_comments === "number" ? postData.num_comments : 0,
    nodes,
    edges,
    fetchedAt: Date.now(),
    isTruncated: isTruncating,
    sanitized: true,
  };
}
