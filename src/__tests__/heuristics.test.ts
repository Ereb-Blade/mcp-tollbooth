import { describe, it, expect } from "vitest";
import { categorize, estimateTokens } from "../heuristics.js";

describe("categorize()", () => {
  // Regression tests: categorize() used to match keywords as loose substrings,
  // which produced false positives on real-world package names. Token-based
  // matching fixed this — these cases must never regress back to substring matching.
  it("does not false-positive on substrings of category keywords", () => {
    expect(categorize("digital-ocean")).toBe("other"); // "git" inside "digital"
    expect(categorize("legitimate-tool")).toBe("other"); // "git" inside "legitimate"
    expect(categorize("research-helper")).toBe("other"); // "search" inside "research"
    expect(categorize("blogs-mcp")).toBe("other"); // "logs" inside "blogs"
    expect(categorize("example-mcp")).toBe("other"); // "exa" inside "example"
    expect(categorize("awesome-tool")).toBe("other"); // "aws" inside "awesome"
  });

  it("still matches real, whole-word category keywords", () => {
    expect(categorize("github")).toBe("vcs");
    expect(categorize("my-github-tool")).toBe("vcs");
    expect(categorize("mongodb")).toBe("database");
    expect(categorize("fs-tool")).toBe("filesystem");
    expect(categorize("playwright")).toBe("browser-automation");
  });

  it("checks both server name and package name", () => {
    expect(categorize("my-custom-server", "@modelcontextprotocol/server-slack")).toBe("communication");
  });

  it("falls back to 'other' for unrecognized names", () => {
    expect(categorize("totally-unknown-thing")).toBe("other");
  });
});

describe("estimateTokens()", () => {
  it("returns known cost for a recognized npx package", () => {
    const result = estimateTokens("@playwright/mcp", "npx-package");
    expect(result).toEqual({ tokens: 3200, confidence: "known" });
  });

  it("keeps npx and uvx token tables separate for same-named packages", () => {
    // "mcp-server-fetch" is a known uvx/PyPI package but NOT in the npm table —
    // an npx-invoked package with the same name must never inherit the uvx number.
    const uvxResult = estimateTokens("mcp-server-fetch", "uvx-package");
    expect(uvxResult).toEqual({ tokens: 350, confidence: "known" });

    const npxResult = estimateTokens("mcp-server-fetch", "npx-package");
    expect(npxResult.confidence).toBe("heuristic");
    expect(npxResult.tokens).not.toBe(350);
  });

  it("falls back to shape-based heuristics for unknown packages", () => {
    expect(estimateTokens(undefined, "remote-http")).toEqual({ tokens: 1500, confidence: "heuristic" });
    expect(estimateTokens(undefined, "local-binary")).toEqual({ tokens: 1000, confidence: "heuristic" });
    expect(estimateTokens("some-random-uvx-tool", "uvx-package")).toEqual({ tokens: 700, confidence: "heuristic" });
    expect(estimateTokens("some-random-npx-tool", "npx-package")).toEqual({ tokens: 800, confidence: "heuristic" });
  });
});
