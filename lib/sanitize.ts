// HTML sanitization for Reddit comment body_html
// Uses DOMPurify with an allowlist of safe tags/attributes
// Note: sanitization strategy (server vs client) determined by Day 1 benchmark
// This module provides the server-side implementation

// Reddit double-encodes HTML entities in body_html.
// The JSON parser handles one level, but we need to decode one more.
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
};

/**
 * Decode HTML entities that Reddit double-encodes in body_html.
 */
export function decodeHtmlEntities(html: string): string {
  return html.replace(
    /&(?:amp|lt|gt|quot|#39|#x27|#x2F);/g,
    (match) => ENTITY_MAP[match] ?? match
  );
}

// Allowlisted tags and attributes for DOMPurify
const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "span",
  "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr",
  "ul",
];

const ALLOWED_ATTR = ["href", "title"];

// Lazy-load DOMPurify to avoid jsdom overhead on every import
let purify: ((html: string) => string) | null = null;

async function getPurify(): Promise<(html: string) => string> {
  if (purify) return purify;

  // Dynamic import to keep jsdom out of the critical path
  const DOMPurify = (await import("isomorphic-dompurify")).default;
  purify = (html: string) =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });

  return purify;
}

/**
 * Sanitize Reddit comment HTML.
 * 1. Decode double-encoded HTML entities
 * 2. Run through DOMPurify with allowlisted tags
 *
 * Pass `skipSanitize: true` to only decode entities (for client-side sanitization strategy).
 */
export async function sanitizeHtml(
  html: string,
  options?: { skipSanitize?: boolean }
): Promise<string> {
  const decoded = decodeHtmlEntities(html);

  if (options?.skipSanitize) {
    return decoded;
  }

  const sanitize = await getPurify();
  return sanitize(decoded);
}
