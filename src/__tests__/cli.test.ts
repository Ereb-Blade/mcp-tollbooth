import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Integration tests against the actually-built CLI (dist/index.js), since
// index.ts runs program.parseAsync() at module scope and can't be unit-tested
// in isolation. Requires `npm run build` to have already produced dist/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, "..", "..", "dist", "index.js");
const demoConfig = path.join(__dirname, "..", "..", "test-configs", "demo.mcp.json");

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], { encoding: "utf-8" });
    return { stdout, status: 0 };
  } catch (err: any) {
    return { stdout: err.stdout?.toString() ?? "", status: err.status ?? 1 };
  }
}

describe.skipIf(!existsSync(cliPath))("CLI --max-tokens (integration, requires `npm run build` first)", () => {
  it("exits 0 and prints a success message when under budget", () => {
    const { stdout, status } = runCli(["--config", demoConfig, "--max-tokens", "999999"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Within token budget/);
  });

  it("exits 1 and prints a failure message when over budget", () => {
    const { stdout, status } = runCli(["--config", demoConfig, "--max-tokens", "1"]);
    expect(status).toBe(1);
    expect(stdout).toMatch(/Token budget exceeded/);
  });

  it("exits 1 for a non-numeric --max-tokens value", () => {
    const { status } = runCli(["--config", demoConfig, "--max-tokens", "not-a-number"]);
    expect(status).toBe(1);
  });

  it("still exits 0 without --max-tokens (report-only mode unaffected)", () => {
    const { status } = runCli(["--config", demoConfig]);
    expect(status).toBe(0);
  });
});
