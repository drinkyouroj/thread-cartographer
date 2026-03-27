// AFINN-165 based sentiment scoring
// Preprocessing: strips URLs, quote blocks, and markdown formatting before scoring
// Normalization: score / (|score| + 5) to dampen short-comment dominance
// Thresholds: > 0.2 positive, < -0.2 negative, else neutral

import { afinn } from "./afinn";

/**
 * Preprocess Reddit markdown text before sentiment scoring.
 * Strips URLs, quote blocks, and markdown formatting.
 */
function preprocess(text: string): string {
  let cleaned = text;

  // Remove quote blocks (lines starting with >)
  cleaned = cleaned.replace(/^>.*$/gm, "");

  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/g, "");

  // Remove markdown links [text](url) — keep the text
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove markdown formatting
  cleaned = cleaned.replace(/~~(.*?)~~/g, "$1"); // strikethrough
  cleaned = cleaned.replace(/\*\*\*(.*?)\*\*\*/g, "$1"); // bold italic
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1"); // bold
  cleaned = cleaned.replace(/\*(.*?)\*/g, "$1"); // italic
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ""); // fenced code blocks (multi-line)
  cleaned = cleaned.replace(/`[^`]*`/g, ""); // inline code

  return cleaned;
}

/**
 * Score the sentiment of a text string using AFINN-165.
 * Returns a normalized value in [-1, 1].
 */
export function scoreSentiment(text: string): number {
  const cleaned = preprocess(text);
  const words = cleaned.toLowerCase().match(/[a-z']+/g);

  if (!words || words.length === 0) return 0;

  let rawScore = 0;
  for (const word of words) {
    if (word in afinn) {
      const val = afinn[word];
      if (typeof val === "number" && !isNaN(val)) {
        rawScore += val;
      }
    }
  }

  // Guard against NaN propagation
  if (isNaN(rawScore)) return 0;

  // Normalize: score / (|score| + 5) — dampens short-comment dominance
  return rawScore / (Math.abs(rawScore) + 5);
}

export type SentimentCategory = "positive" | "neutral" | "negative";

export function classifySentiment(score: number): SentimentCategory {
  if (score > 0.2) return "positive";
  if (score < -0.2) return "negative";
  return "neutral";
}
