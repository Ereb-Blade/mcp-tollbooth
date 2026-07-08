import chalk from "chalk";
import Table from "cli-table3";
import type { AuditReport, DiscoveredConfigFile, ServerAudit } from "./types.js";

function scoreColor(score: number): typeof chalk.green {
  if (score >= 75) return chalk.green;
  if (score >= 50) return chalk.yellow;
  return chalk.red;
}

function scoreLabel(score: number): string {
  if (score >= 75) return "Healthy";
  if (score >= 50) return "Caution";
  return "Risky";
}

export function printBanner(): void {
  console.log(chalk.bold.cyan("\n  MCP Tollbooth") + chalk.dim("  — what your MCP servers are costing your context window\n"));
}

export function printNoConfigsFound(): void {
  console.log(chalk.yellow("No MCP config files with servers were found in the usual locations."));
  console.log(chalk.dim("Checked Claude Desktop, Claude Code (.mcp.json / ~/.claude.json), Cursor and VS Code configs."));
  console.log(chalk.dim("Pass --config <path> to point at a specific file.\n"));
}

export function printDiscoveredFiles(files: DiscoveredConfigFile[]): void {
  console.log(chalk.bold("Scanned config files:"));
  for (const f of files) {
    console.log(`  ${chalk.dim("•")} ${f.source} ${chalk.dim(`(${f.path})`)} — ${Object.keys(f.servers).length} server(s)`);
  }
  console.log("");
}

export function printReport(report: AuditReport): void {
  const table = new Table({
    head: [
      chalk.bold("Server"),
      chalk.bold("Category"),
      chalk.bold("Est. Tokens"),
      chalk.bold("Trust*"),
      chalk.bold("Last Push"),
      chalk.bold("Stars"),
    ],
    style: { head: [], border: [] },
  });

  // Lead with token cost — that's the number every server silently taxes you on,
  // whether or not it turns out to be well-maintained.
  const sorted = [...report.servers].sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  for (const s of sorted) {
    const color = scoreColor(s.trustScore);
    const lastPush = s.githubInfo
      ? `${s.githubInfo.daysSinceLastPush}d ago`
      : chalk.dim("unknown");
    const stars = s.githubInfo ? s.githubInfo.stars.toLocaleString() : chalk.dim("—");
    const tokenStr =
      s.tokenConfidence === "known"
        ? chalk.bold(`~${s.estimatedTokens.toLocaleString()}`)
        : chalk.dim(`~${s.estimatedTokens.toLocaleString()}*`);

    table.push([
      s.serverName,
      chalk.dim(s.category),
      tokenStr,
      color(`${s.trustScore} ${scoreLabel(s.trustScore)}`),
      lastPush,
      stars,
    ]);
  }

  console.log(table.toString());
  console.log(
    chalk.dim(
      "\n* Trust is a rough heuristic (repo activity, stars, license) — not a security scan. Token estimates marked with a trailing * are heuristic, not measured live (see README).\n"
    )
  );

  if (report.overlapGroups.length > 0) {
    console.log(chalk.bold("Overlap detected — you're paying twice for the same job:"));
    for (const group of report.overlapGroups) {
      console.log(
        `  ${chalk.dim("•")} ${chalk.yellow(group.category)}: ${group.serverNames.join(", ")} — do you need all of these?`
      );
    }
    console.log("");
  }

  const lowTrust = sorted.filter((s) => s.trustScore < 50 && s.trustNotes.length > 0);
  if (lowTrust.length > 0) {
    console.log(chalk.bold("Worth a second look:\n"));
    for (const s of lowTrust) {
      const color = scoreColor(s.trustScore);
      console.log(color.bold(`${s.serverName}`) + chalk.dim(`  (${s.configSource})`));
      for (const note of s.trustNotes) {
        console.log(`  ${chalk.dim("-")} ${note}`);
      }
      console.log("");
    }
  }

  for (const warning of report.warnings) {
    console.log(chalk.yellow("⚠ ") + warning);
  }

  const overallColor = scoreColor(report.overallScore);
  console.log(
    "\n" +
      chalk.bold("Total context toll: ") +
      chalk.bold(`~${report.totalEstimatedTokens.toLocaleString()} tokens`) +
      chalk.dim(`  across ${report.servers.length} server(s)`) +
      chalk.dim(`  ·  avg trust ${overallColor(`${report.overallScore}/100`)}`)
  );
  console.log("");
}
