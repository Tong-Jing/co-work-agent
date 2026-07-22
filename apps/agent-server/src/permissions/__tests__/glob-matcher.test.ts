import { describe, expect, it } from "vitest";
import { matchesGlob } from "../glob-matcher.js";

describe("matchesGlob", () => {
  it("matches a single-level wildcard within one path segment", () => {
    expect(matchesGlob("tmp/*.txt", "tmp/scratch.txt")).toBe(true);
    expect(matchesGlob("tmp/*.txt", "tmp/nested/scratch.txt")).toBe(false);
  });

  it("matches a double-star wildcard across any depth", () => {
    expect(matchesGlob("tmp/**", "tmp/a/b.txt")).toBe(true);
    expect(matchesGlob("tmp/**", "tmp/a.txt")).toBe(true);
    expect(matchesGlob("tmp/**", "tmpfile.txt")).toBe(false);
  });

  it("matches a leading double-star across any prefix depth", () => {
    expect(matchesGlob("**/.env*", ".env")).toBe(true);
    expect(matchesGlob("**/.env*", "config/.env.local")).toBe(true);
    expect(matchesGlob("**/.env*", "src/environment.ts")).toBe(false);
  });

  it("matches an exact literal path with no wildcards", () => {
    expect(matchesGlob(".git/config", ".git/config")).toBe(true);
    expect(matchesGlob(".git/config", ".git/other")).toBe(false);
  });

  it("does not match a directory prefix rule against an unrelated path", () => {
    expect(matchesGlob("docs/**", "src/index.ts")).toBe(false);
  });
});
