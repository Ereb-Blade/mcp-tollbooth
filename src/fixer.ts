import { readFileSync, writeFileSync } from "node:fs";
import type { AuditReport, DiscoveredConfigFile, RawMcpServerConfig, ServerAudit } from "./types.js";

/**
 * A group of servers presented together in --fix mode, with a reason they were
 * grouped. "overlap" groups come straight from AuditReport.overlapGroups
 * (same inferred category, so likely redundant with each other). "low-trust"
 * is everything left over with a trust score under 50 — surfaced separately so
 * a lone risky server isn't hidden just because it has no category-mate.
 */
export interface FixCandidateGroup {
  kind: "overlap" | "low-trust";
  category?: string;
  reason: string;
  servers: ServerAudit[];
}

/** Stable identity for a server within a report: (config file, name within that file). */
export function serverKey(s: Pick<ServerAudit, "configSource" | "serverName">): string {
  return `${s.configSource}::${s.serverName}`;
}

export function splitServerKey(key: string): { configSource: string; serverName: string } {
  const idx = key.indexOf("::");
  return { configSource: key.slice(0, idx), serverName: key.slice(idx + 2) };
}

/**
 * Turns an AuditReport into groups of servers worth showing the user in --fix
 * mode. Every server appears at most once across all groups — a server already
 * shown for overlapping with another server of the same category isn't also
 * repeated in the low-trust group, to avoid asking about it twice.
 */
export function computeFixCandidates(report: AuditReport): FixCandidateGroup[] {
  const groups: FixCandidateGroup[] = [];
  const seen = new Set<string>();

  for (const overlap of report.overlapGroups) {
    const servers = report.servers.filter(
      (s) => s.category === overlap.category && overlap.serverNames.includes(s.serverName)
    );
    if (servers.length === 0) continue;
    for (const s of servers) seen.add(serverKey(s));
    groups.push({
      kind: "overlap",
      category: overlap.category,
      reason: `${servers.length} "${overlap.category}" servers detected — you're likely paying for the same job twice.`,
      servers,
    });
  }

  const lowTrust = report.servers.filter((s) => s.trustScore < 50 && !seen.has(serverKey(s)));
  if (lowTrust.length > 0) {
    for (const s of lowTrust) seen.add(serverKey(s));
    groups.push({
      kind: "low-trust",
      reason: "Low trust score — unmaintained, archived, or unverifiable.",
      servers: lowTrust,
    });
  }

  return groups;
}

export interface FixSelection {
  configSource: string;
  serverName: string;
}

export interface FixPlan {
  file: DiscoveredConfigFile;
  removedServerNames: string[];
}

/**
 * Groups selections by their source config file and drops any selection that
 * doesn't match a real file/server (defensive against a stale selection —
 * should never happen in practice since options come straight from the report,
 * but a silently-wrong write is worse than an ignored one).
 */
export function buildFixPlans(configFiles: DiscoveredConfigFile[], selections: FixSelection[]): FixPlan[] {
  const bySource = new Map<string, DiscoveredConfigFile>();
  for (const f of configFiles) bySource.set(f.source, f);

  const removalsBySource = new Map<string, Set<string>>();
  for (const sel of selections) {
    if (!bySource.get(sel.configSource)?.servers[sel.serverName]) continue;
    const set = removalsBySource.get(sel.configSource) ?? new Set<string>();
    set.add(sel.serverName);
    removalsBySource.set(sel.configSource, set);
  }

  const plans: FixPlan[] = [];
  for (const [source, names] of removalsBySource) {
    const file = bySource.get(source);
    if (!file) continue;
    plans.push({ file, removedServerNames: [...names] });
  }
  return plans;
}

/** Which top-level key holds the servers map — mirrors configLocator's extractServers(). */
function serversContainerKey(parsed: Record<string, unknown>): "mcpServers" | "servers" {
  if (parsed.mcpServers && typeof parsed.mcpServers === "object") return "mcpServers";
  return "servers";
}

export interface WriteFixPlanResult {
  path: string;
  backupPath: string;
  removedServerNames: string[];
}

/**
 * Applies one plan to disk: backs up the untouched original file byte-for-byte,
 * then rewrites it with only the selected servers deleted from the servers
 * container — every other key (other settings, formatting-adjacent fields,
 * unrelated servers) is preserved as parsed/re-serialized JSON.
 *
 * Never call this without the caller having shown the user a diff and gotten
 * explicit confirmation first — this mutates the user's real MCP config file.
 */
export function writeFixPlan(plan: FixPlan): WriteFixPlanResult {
  const raw = readFileSync(plan.file.path, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const key = serversContainerKey(parsed);
  const container = (parsed[key] as Record<string, RawMcpServerConfig> | undefined) ?? {};

  const actuallyRemoved: string[] = [];
  for (const name of plan.removedServerNames) {
    if (name in container) {
      delete container[name];
      actuallyRemoved.push(name);
    }
  }

  const backupPath = `${plan.file.path}.bak-${Date.now()}`;
  writeFileSync(backupPath, raw, "utf-8");
  writeFileSync(plan.file.path, JSON.stringify(parsed, null, 2) + "\n", "utf-8");

  return { path: plan.file.path, backupPath, removedServerNames: actuallyRemoved };
}

/** Plain-text diff-style preview for confirmation prompts, before anything is written. */
export function renderFixPreview(plans: FixPlan[]): string {
  return plans
    .map((p) => {
      const lines = [p.file.path];
      for (const name of p.removedServerNames) lines.push(`  - ${name}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
