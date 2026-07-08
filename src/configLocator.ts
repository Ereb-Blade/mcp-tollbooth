import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { DiscoveredConfigFile, RawMcpServerConfig } from "./types.js";

interface CandidateConfig {
  source: string;
  path: string;
}

function candidatePaths(): CandidateConfig[] {
  const home = homedir();
  const cwd = process.cwd();
  const plat = platform();

  const candidates: CandidateConfig[] = [
    // Project-scoped configs (Claude Code / Cursor convention)
    { source: "Claude Code (project .mcp.json)", path: join(cwd, ".mcp.json") },
    { source: "Cursor (project .cursor/mcp.json)", path: join(cwd, ".cursor", "mcp.json") },
    { source: "VS Code (project .vscode/mcp.json)", path: join(cwd, ".vscode", "mcp.json") },

    // User-scoped configs
    { source: "Claude Code (user ~/.claude.json)", path: join(home, ".claude.json") },
    { source: "Cursor (user ~/.cursor/mcp.json)", path: join(home, ".cursor", "mcp.json") },
  ];

  if (plat === "darwin") {
    candidates.push({
      source: "Claude Desktop (macOS)",
      path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    });
  } else if (plat === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    candidates.push({
      source: "Claude Desktop (Windows)",
      path: join(appData, "Claude", "claude_desktop_config.json"),
    });
  } else {
    candidates.push({
      source: "Claude Desktop (Linux)",
      path: join(home, ".config", "Claude", "claude_desktop_config.json"),
    });
  }

  return candidates;
}

function extractServers(raw: unknown): Record<string, RawMcpServerConfig> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const servers = obj.mcpServers ?? obj.servers;
  if (!servers || typeof servers !== "object") return {};
  return servers as Record<string, RawMcpServerConfig>;
}

/** Thrown only for an explicitly-passed --config path, so failures are never confused with "nothing found in usual locations". */
export class ExplicitConfigError extends Error {}

/**
 * Scans known MCP config locations (Claude Desktop, Claude Code, Cursor, VS Code)
 * and returns every config file that actually exists and declares servers.
 *
 * If `explicitPath` is given, a missing file, unreadable/invalid JSON, or a
 * valid file with zero servers all throw ExplicitConfigError with a specific
 * reason — silently falling through to "no configs found" would be misleading
 * when the user pointed us at a file directly.
 */
export function discoverConfigFiles(explicitPath?: string): DiscoveredConfigFile[] {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new ExplicitConfigError(`No file found at "${explicitPath}".`);
    }
    let parsed: unknown;
    try {
      const content = readFileSync(explicitPath, "utf-8");
      parsed = JSON.parse(content);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExplicitConfigError(`Could not read/parse "${explicitPath}" as JSON: ${reason}`);
    }
    const servers = extractServers(parsed);
    if (Object.keys(servers).length === 0) {
      throw new ExplicitConfigError(
        `"${explicitPath}" is valid JSON but has no "mcpServers" (or "servers") entries.`
      );
    }
    return [{ source: "Custom path", path: explicitPath, servers }];
  }

  const found: DiscoveredConfigFile[] = [];
  for (const candidate of candidatePaths()) {
    if (!existsSync(candidate.path)) continue;
    try {
      const content = readFileSync(candidate.path, "utf-8");
      const parsed = JSON.parse(content);
      const servers = extractServers(parsed);
      if (Object.keys(servers).length > 0) {
        found.push({ source: candidate.source, path: candidate.path, servers });
      }
    } catch {
      // Skip unreadable/invalid JSON in auto-discovered files rather than crashing the whole scan —
      // here it's reasonable to stay silent since we're speculatively probing several locations.
    }
  }

  return found;
}
