// HTML sanitization for Reddit comment body_html
// Uses sanitize-html (pure JS, no jsdom dependency)
// Switched from isomorphic-dompurify after Day 1 benchmark:
//   jsdom has ESM/CJS incompatibility on Vercel serverless runtime

import sanitize from "sanitize-html";

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

// Allowlisted tags and attributes
const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "span",
  "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr",
  "ul",
];

const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
};

/**
 * Sanitize Reddit comment HTML.
 * 1. Decode double-encoded HTML entities
 * 2. Run through sanitize-html with allowlisted tags
 *
 * Pass `skipSanitize: true` to only decode entities (for client-side sanitization strategy).
 */
export function sanitizeHtml(
  html: string,
  options?: { skipSanitize?: boolean }
): string {
  const decoded = decodeHtmlEntities(html);

  if (options?.skipSanitize) {
    return decoded;
  }

  return sanitize(decoded, SANITIZE_OPTIONS);
}
