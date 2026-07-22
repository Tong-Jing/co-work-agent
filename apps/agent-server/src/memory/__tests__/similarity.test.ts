import { describe, expect, it } from "vitest";
import { cosineSimilarity, recencyDecay } from "../similarity.js";
import { contentHash } from "../content-hash.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 for mismatched lengths or empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("recencyDecay", () => {
  it("returns close to 1 for something created just now", () => {
    expect(recencyDecay(new Date().toISOString())).toBeCloseTo(1, 1);
  });

  it("decays to roughly half at the half-life", () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(recencyDecay(thirtyDaysAgo, 30)).toBeCloseTo(0.5, 1);
  });
});

describe("contentHash", () => {
  it("produces the same hash for equivalent content regardless of case/punctuation/whitespace", () => {
    const a = contentHash("User prefers TypeScript.");
    const b = contentHash("user prefers   typescript");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    expect(contentHash("uses npm")).not.toBe(contentHash("uses pnpm"));
  });
});
