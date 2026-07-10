import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auditConfigFiles } from "../auditor.js";
import type { DiscoveredConfigFile } from "../types.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map<string, string>(),
    json: async () => body,
  } as unknown as Response;
}

describe("auditConfigFiles()", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("registry.npmjs.org")) {
        return jsonResponse({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { repository: null } } });
      }
      if (u.includes("api.github.com")) {
        return jsonResponse({}, 404); // no repo info by default in these tests
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function configWith(servers: Record<string, { command: string; args?: string[] }>): DiscoveredConfigFile[] {
    return [{ source: "Custom path", path: "/fake.json", servers }];
  }

  it("flags overlap when two servers share a category", () => {
    return auditConfigFiles(
      configWith({
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        gitlab: { command: "npx", args: ["-y", "some-gitlab-tool"] },
      })
    ).then((report) => {
      expect(report.overlapGroups).toHaveLength(1);
      expect(report.overlapGroups[0].category).toBe("vcs");
      expect(report.overlapGroups[0].serverNames.sort()).toEqual(["github", "gitlab"]);
    });
  });

  it("does not flag overlap for a single server per category", () => {
    return auditConfigFiles(
      configWith({
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
      })
    ).then((report) => {
      expect(report.overlapGroups).toHaveLength(0);
    });
  });

  it("never groups 'other'-category servers as overlap, even with 2+", () => {
    return auditConfigFiles(
      configWith({
        weird1: { command: "/usr/local/bin/weird-tool-1" },
        weird2: { command: "/usr/local/bin/weird-tool-2" },
      })
    ).then((report) => {
      expect(report.overlapGroups).toHaveLength(0);
    });
  });

  it("sums estimated tokens across all servers", () => {
    return auditConfigFiles(
      configWith({
        playwright: { command: "npx", args: ["-y", "@playwright/mcp"] }, // known: 3200
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] }, // known: 900
      })
    ).then((report) => {
      expect(report.totalEstimatedTokens).toBe(4100);
    });
  });

  it("aggregates a rate-limit warning exactly once when any server hits it, not once per server", async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes("registry.npmjs.org")) {
        return jsonResponse({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { repository: "https://github.com/foo/bar" } } });
      }
      if (u.includes("api.github.com")) {
        const headers = new Map([["x-ratelimit-remaining", "0"]]);
        return { ok: false, status: 403, headers, json: async () => ({}) } as unknown as Response;
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const report = await auditConfigFiles(
      configWith({
        a: { command: "npx", args: ["-y", "pkg-a"] },
        b: { command: "npx", args: ["-y", "pkg-b"] },
      })
    );
    const rateLimitWarnings = report.warnings.filter((w) => w.includes("rate limit"));
    expect(rateLimitWarnings).toHaveLength(1);
  });

  it("scores an 'unknown' server kind as low-trust with an explanatory note", () => {
    return auditConfigFiles(configWith({ mystery: {} as { command: string } })).then((report) => {
      const s = report.servers.find((s) => s.serverName === "mystery")!;
      expect(s.kind).toBe("unknown");
      expect(s.trustScore).toBe(20);
      expect(s.trustNotes.join(" ")).toMatch(/untrusted/i);
    });
  });

  it("warns when total token budget exceeds 40,000", () => {
    const manyServers: Record<string, { command: string; args?: string[] }> = {};
    for (let i = 0; i < 20; i++) {
      manyServers[`server-${i}`] = { command: "npx", args: ["-y", `@playwright/mcp`] }; // 3200 each -> 64,000 total
    }
    return auditConfigFiles(configWith(manyServers)).then((report) => {
      expect(report.totalEstimatedTokens).toBeGreaterThan(40000);
      expect(report.warnings.some((w) => w.includes("Consider trimming"))).toBe(true);
    });
  });
});