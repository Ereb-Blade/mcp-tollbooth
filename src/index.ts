#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { auditConfigFiles } from "./auditor.js";
import { discoverConfigFiles, ExplicitConfigError } from "./configLocator.js";
import {
  printBanner,
  printDiscoveredFiles,
  printNoConfigsFound,
  printReport,
} from "./report.js";
import chalk from "chalk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("mcp-tollbooth")
  .description("Measure the context-window toll of your MCP servers and flag duplicates. (Trust/staleness checks included as a secondary signal.)")
  .version(pkg.version)
  .option("-c, --config <path>", "path to a specific MCP config file to audit")
  .option("--json", "output raw JSON instead of a formatted report")
  .option("--max-tokens <n>", "exit with code 1 if total estimated tokens exceed this budget (for CI use)", (v) => parseInt(v, 10))
  .action(async (opts: { config?: string; json?: boolean; maxTokens?: number }) => {
    let configFiles;
    try {
      configFiles = discoverConfigFiles(opts.config);
    } catch (err) {
      if (err instanceof ExplicitConfigError) {
        if (opts.json) {
          console.log(JSON.stringify({ error: err.message }, null, 2));
        } else {
          if (!opts.json) printBanner();
          console.log(chalk.red(`✗ ${err.message}`));
        }
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    if (!opts.json) printBanner();

    if (configFiles.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ servers: [], message: "no config files found" }, null, 2));
      } else {
        printNoConfigsFound();
      }
      // A missing config is not itself a budget failure — nothing to measure.
      return;
    }

    if (!opts.json) printDiscoveredFiles(configFiles);

    const report = await auditConfigFiles(configFiles);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    if (opts.maxTokens !== undefined) {
      if (Number.isNaN(opts.maxTokens) || opts.maxTokens < 0) {
        if (!opts.json) console.log(chalk.red(`✗ --max-tokens expects a non-negative number.`));
        process.exitCode = 1;
        return;
      }
      if (report.totalEstimatedTokens > opts.maxTokens) {
        if (!opts.json) {
          console.log(
            chalk.red(
              `\n✗ Token budget exceeded: ~${report.totalEstimatedTokens.toLocaleString()} > ${opts.maxTokens.toLocaleString()} allowed.`
            )
          );
        }
        process.exitCode = 1;
      } else if (!opts.json) {
        console.log(chalk.green(`\n✓ Within token budget (~${report.totalEstimatedTokens.toLocaleString()} / ${opts.maxTokens.toLocaleString()}).`));
      }
    }
  });

program.parseAsync(process.argv);
