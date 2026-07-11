import { cancel, confirm, intro, isCancel, log, multiselect, note, outro } from "@clack/prompts";
import chalk from "chalk";
import type { AuditReport, DiscoveredConfigFile } from "./types.js";
import {
  buildFixPlans,
  computeFixCandidates,
  renderFixPreview,
  serverKey,
  splitServerKey,
  writeFixPlan,
  type FixSelection,
} from "./fixer.js";

/**
 * Runs the interactive --fix wizard: walks each overlap/low-trust group,
 * collects what to disable, shows a diff, and only writes to disk after an
 * explicit confirm. Returns true if any file was actually changed.
 */
export async function runFixWizard(report: AuditReport, configFiles: DiscoveredConfigFile[]): Promise<boolean> {
  intro(chalk.bold.cyan("mcp-tollbooth --fix"));

  const groups = computeFixCandidates(report);

  if (groups.length === 0) {
    note("No overlapping or low-trust servers found — nothing to fix.", "All clear");
    outro("Done.");
    return false;
  }

  const selections: FixSelection[] = [];

  for (const group of groups) {
    const options = group.servers.map((s) => ({
      value: serverKey(s),
      label: `${s.serverName} ${chalk.dim(`(${s.configSource})`)}`,
      hint: `~${s.estimatedTokens.toLocaleString()} tok · trust ${s.trustScore}`,
    }));

    // For overlap groups, default to keeping the highest-trust server and
    // pre-selecting the rest for removal — that's almost always the right
    // call and turns this into a one-Enter-press confirm for the common case.
    // For low-trust servers there's no "keep the best one" logic that applies,
    // so nothing is pre-selected; the user opts in explicitly.
    let initialValues: string[] = [];
    if (group.kind === "overlap") {
      const sorted = [...group.servers].sort((a, b) => b.trustScore - a.trustScore);
      initialValues = sorted.slice(1).map((s) => serverKey(s));
    }

    const message =
      group.kind === "overlap"
        ? `${chalk.yellow(group.category ?? "")}: ${group.reason}\n  Select servers to DISABLE:`
        : `${group.reason}\n  Select servers to DISABLE:`;

    const picked = await multiselect({
      message,
      options,
      initialValues,
      required: false,
    });

    if (isCancel(picked)) {
      cancel("Cancelled — no changes made.");
      return false;
    }

    for (const val of picked as string[]) {
      selections.push(splitServerKey(val));
    }
  }

  if (selections.length === 0) {
    outro("Nothing selected — no changes made.");
    return false;
  }

  const plans = buildFixPlans(configFiles, selections);

  if (plans.length === 0) {
    outro("Nothing selected — no changes made.");
    return false;
  }

  note(renderFixPreview(plans), "Planned changes (a backup is kept alongside each file)");

  const proceed = await confirm({
    message: `Apply these changes to ${plans.length} config file${plans.length === 1 ? "" : "s"}?`,
    initialValue: false,
  });

  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — no changes made.");
    return false;
  }

  for (const plan of plans) {
    try {
      const result = writeFixPlan(plan);
      log.success(
        `${plan.file.source}: disabled ${result.removedServerNames.join(", ")}\n  backup saved at ${result.backupPath}`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error(`${plan.file.source}: failed to write changes — ${reason}`);
    }
  }

  outro(chalk.green("Done — restart your MCP client to pick up the changes."));
  return true;
}
