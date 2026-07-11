import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeFixCandidates,
  buildFixPlans,
  writeFixPlan,
  renderFixPreview,
  serverKey,
  splitServerKey,
} from "../fixer.js";
import type { AuditReport, DiscoveredConfigFile, ServerAudit } from "../types.js";

function makeServer(overrides: Partial<ServerAudit>): ServerAudit {
  return {
    configSource: "Claude Code (project .mcp.json)",
    serverName: "server",
    kind: "npx-package",
    rawCommandLine: "npx -y server",
    category: "other",
    estimatedTokens: 500,
    tokenConfidence: "heuristic",
    trustScore: 80,
    trustNotes: [],
    ...overrides,
  };
}

describe("serverKey / splitServerKey", () => {
  it("round-trips a config source and server name", () => {
    const key = serverKey({ configSource: "Claude Desktop (macOS)", serverName: "github" });
    expect(key).toBe("Claude Desktop (macOS)::github");
    expect(splitServerKey(key)).toEqual({ configSource: "Claude Desktop (macOS)", serverName: "github" });
  });
});

describe("computeFixCandidates()", () => {
  it("groups overlapping servers by category", () => {
    const github = makeServer({ serverName: "github", category: "vcs", trustScore: 90 });
    const gitlab = makeServer({ serverName: "gitlab", category: "vcs", trustScore: 60 });
    const report: AuditReport = {
      servers: [github, gitlab],
      totalEstimatedTokens: 1000,
      overallScore: 75,
      overlapGroups: [{ category: "vcs", serverNames: ["github", "gitlab"] }],
      warnings: [],
    };

    const groups = computeFixCandidates(report);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("overlap");
    expect(groups[0].servers.map((s) => s.serverName).sort()).toEqual(["github", "gitlab"]);
  });

  it("surfaces low-trust servers not already covered by an overlap group", () => {
    const risky = makeServer({ serverName: "sketchy-tool", category: "other", trustScore: 20 });
    const healthy = makeServer({ serverName: "solid-tool", category: "other", trustScore: 90 });
    const report: AuditReport = {
      servers: [risky, healthy],
      totalEstimatedTokens: 1000,
      overallScore: 55,
      overlapGroups: [],
      warnings: [],
    };

    const groups = computeFixCandidates(report);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("low-trust");
    expect(groups[0].servers.map((s) => s.serverName)).toEqual(["sketchy-tool"]);
  });

  it("does not show a server in both an overlap group and the low-trust group", () => {
    const lowTrustOverlap = makeServer({ serverName: "old-git-tool", category: "vcs", trustScore: 10 });
    const otherOverlap = makeServer({ serverName: "github", category: "vcs", trustScore: 90 });
    const report: AuditReport = {
      servers: [lowTrustOverlap, otherOverlap],
      totalEstimatedTokens: 1000,
      overallScore: 50,
      overlapGroups: [{ category: "vcs", serverNames: ["old-git-tool", "github"] }],
      warnings: [],
    };

    const groups = computeFixCandidates(report);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("overlap");
  });

  it("returns no groups when everything is healthy and non-overlapping", () => {
    const report: AuditReport = {
      servers: [makeServer({ trustScore: 90 })],
      totalEstimatedTokens: 500,
      overallScore: 90,
      overlapGroups: [],
      warnings: [],
    };
    expect(computeFixCandidates(report)).toHaveLength(0);
  });
});

describe("buildFixPlans()", () => {
  const file: DiscoveredConfigFile = {
    source: "Claude Code (project .mcp.json)",
    path: "/tmp/does-not-matter.json",
    servers: {
      github: { command: "npx", args: ["-y", "server-github"] },
      gitlab: { command: "npx", args: ["-y", "server-gitlab"] },
    },
  };

  it("groups selections by config file and ignores duplicates", () => {
    const plans = buildFixPlans(
      [file],
      [
        { configSource: file.source, serverName: "github" },
        { configSource: file.source, serverName: "github" },
      ]
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].removedServerNames).toEqual(["github"]);
  });

  it("silently drops a selection that doesn't match a real file/server", () => {
    const plans = buildFixPlans([file], [{ configSource: "Nonexistent source", serverName: "github" }]);
    expect(plans).toHaveLength(0);
  });

  it("silently drops a selection naming a server not present in that file", () => {
    const plans = buildFixPlans([file], [{ configSource: file.source, serverName: "not-a-real-server" }]);
    expect(plans).toHaveLength(0);
  });
});

describe("writeFixPlan()", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("removes only the selected server, preserves everything else, and writes a backup", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-fix-test-"));
    const path = join(dir, "config.json");
    const original = {
      someUnrelatedTopLevelSetting: true,
      mcpServers: {
        github: { command: "npx", args: ["-y", "server-github"] },
        gitlab: { command: "npx", args: ["-y", "server-gitlab"] },
      },
    };
    writeFileSync(path, JSON.stringify(original, null, 2));

    const file: DiscoveredConfigFile = { source: "test", path, servers: original.mcpServers };
    const result = writeFixPlan({ file, removedServerNames: ["gitlab"] });

    expect(result.removedServerNames).toEqual(["gitlab"]);
    expect(existsSync(result.backupPath)).toBe(true);
    expect(JSON.parse(readFileSync(result.backupPath, "utf-8"))).toEqual(original);

    const rewritten = JSON.parse(readFileSync(path, "utf-8"));
    expect(rewritten.someUnrelatedTopLevelSetting).toBe(true);
    expect(Object.keys(rewritten.mcpServers)).toEqual(["github"]);
  });

  it("preserves the 'servers' key alias instead of introducing 'mcpServers'", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-fix-test-"));
    const path = join(dir, "config.json");
    const original = { servers: { fs: { command: "npx", args: ["-y", "server-fs"] } } };
    writeFileSync(path, JSON.stringify(original, null, 2));

    const file: DiscoveredConfigFile = { source: "test", path, servers: original.servers };
    writeFixPlan({ file, removedServerNames: [] });

    const rewritten = JSON.parse(readFileSync(path, "utf-8"));
    expect(rewritten.servers).toBeDefined();
    expect(rewritten.mcpServers).toBeUndefined();
  });

  it("only reports servers that actually existed as removed", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-fix-test-"));
    const path = join(dir, "config.json");
    const original = { mcpServers: { github: { command: "npx", args: ["-y", "server-github"] } } };
    writeFileSync(path, JSON.stringify(original, null, 2));

    const file: DiscoveredConfigFile = { source: "test", path, servers: original.mcpServers };
    const result = writeFixPlan({ file, removedServerNames: ["github", "ghost-server"] });

    expect(result.removedServerNames).toEqual(["github"]);
  });
});

describe("renderFixPreview()", () => {
  it("lists the file path and each removed server as a bullet", () => {
    const file: DiscoveredConfigFile = { source: "test", path: "/tmp/config.json", servers: {} };
    const preview = renderFixPreview([{ file, removedServerNames: ["gitlab", "old-tool"] }]);
    expect(preview).toContain("/tmp/config.json");
    expect(preview).toContain("- gitlab");
    expect(preview).toContain("- old-tool");
  });
});
