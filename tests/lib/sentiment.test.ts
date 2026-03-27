import { describe, it, expect } from "vitest";
import { scoreSentiment, classifySentiment } from "@/lib/sentiment";

describe("scoreSentiment", () => {
  it("returns positive score for positive text", () => {
    const score = scoreSentiment("This is great and wonderful and amazing");
    expect(score).toBeGreaterThan(0);
  });

  it("returns negative score for negative text", () => {
    const score = scoreSentiment("This is terrible and awful and disgusting");
    expect(score).toBeLessThan(0);
  });

  it("returns zero for empty text", () => {
    expect(scoreSentiment("")).toBe(0);
  });

  it("returns zero for text with no sentiment words", () => {
    const score = scoreSentiment("The cat sat on the mat");
    expect(score).toBe(0);
  });

  it("returns value in [-1, 1] range", () => {
    const positiveScore = scoreSentiment("love love love love love");
    const negativeScore = scoreSentiment("hate hate hate hate hate");
    expect(positiveScore).toBeLessThanOrEqual(1);
    expect(positiveScore).toBeGreaterThan(0);
    expect(negativeScore).toBeGreaterThanOrEqual(-1);
    expect(negativeScore).toBeLessThan(0);
  });

  it("strips URLs before scoring", () => {
    const withUrl = scoreSentiment("check https://www.evil-terrible-awful.com/bad");
    const without = scoreSentiment("check");
    expect(withUrl).toBe(without);
  });

  it("strips quote blocks before scoring", () => {
    const withQuote = scoreSentiment("> This is terrible\nThis is great");
    const withoutQuote = scoreSentiment("This is great");
    expect(withQuote).toBe(withoutQuote);
  });

  it("strips markdown formatting before scoring", () => {
    const bold = scoreSentiment("**great**");
    const plain = scoreSentiment("great");
    expect(bold).toBe(plain);
  });

  it("strips markdown links keeping text", () => {
    const link = scoreSentiment("[great](https://example.com)");
    const plain = scoreSentiment("great");
    expect(link).toBe(plain);
  });

  it("strips multi-line fenced code blocks", () => {
    const withCode = scoreSentiment("good\n```\nterrible awful bad\n```\ngood");
    const withoutCode = scoreSentiment("good\n\ngood");
    expect(withCode).toBe(withoutCode);
  });

  it("strips inline code", () => {
    const withCode = scoreSentiment("the `terrible` variable");
    const withoutCode = scoreSentiment("the  variable");
    expect(withCode).toBe(withoutCode);
  });
});

describe("classifySentiment", () => {
  it("classifies positive scores above 0.2", () => {
    expect(classifySentiment(0.3)).toBe("positive");
    expect(classifySentiment(1.0)).toBe("positive");
  });

  it("classifies negative scores below -0.2", () => {
    expect(classifySentiment(-0.3)).toBe("negative");
    expect(classifySentiment(-1.0)).toBe("negative");
  });

  it("classifies neutral scores between -0.2 and 0.2", () => {
    expect(classifySentiment(0)).toBe("neutral");
    expect(classifySentiment(0.1)).toBe("neutral");
    expect(classifySentiment(-0.1)).toBe("neutral");
    expect(classifySentiment(0.2)).toBe("neutral");
    expect(classifySentiment(-0.2)).toBe("neutral");
  });
});
