#!/usr/bin/env node
import { Command } from "commander";
import { auditConfigFiles } from "./auditor.js";
import { discoverConfigFiles, ExplicitConfigError } from "./configLocator.js";
import {
  printBanner,
  printDiscoveredFiles,
  printNoConfigsFound,
  printReport,
} from "./report.js";
import chalk from "chalk";

const program = new Command();

program
  .name("mcp-tollbooth")
  .description("Measure the context-window toll of your MCP servers and flag duplicates. (Trust/staleness checks included as a secondary signal.)")
  .version("0.1.0")
  .option("-c, --config <path>", "path to a specific MCP config file to audit")
  .option("--json", "output raw JSON instead of a formatted report")
  .action(async (opts: { config?: string; json?: boolean }) => {
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
      return;
    }

    if (!opts.json) printDiscoveredFiles(configFiles);

    const report = await auditConfigFiles(configFiles);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  });

program.parseAsync(process.argv);
