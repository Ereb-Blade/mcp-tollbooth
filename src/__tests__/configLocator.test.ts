import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigFiles, ExplicitConfigError } from "../configLocator.js";

describe("discoverConfigFiles() with an explicit path", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("throws ExplicitConfigError for a missing file, not a silent empty result", () => {
    expect(() => discoverConfigFiles("/no/such/file/anywhere.json")).toThrow(ExplicitConfigError);
    expect(() => discoverConfigFiles("/no/such/file/anywhere.json")).toThrow(/No file found/);
  });

  it("throws ExplicitConfigError for invalid JSON, not a silent empty result", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-test-"));
    const file = join(dir, "broken.json");
    writeFileSync(file, "{ this is not valid json");
    expect(() => discoverConfigFiles(file)).toThrow(ExplicitConfigError);
    expect(() => discoverConfigFiles(file)).toThrow(/Could not read\/parse/);
  });

  it("throws ExplicitConfigError for valid JSON with no server entries", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-test-"));
    const file = join(dir, "empty.json");
    writeFileSync(file, JSON.stringify({ someOtherKey: true }));
    expect(() => discoverConfigFiles(file)).toThrow(ExplicitConfigError);
    expect(() => discoverConfigFiles(file)).toThrow(/no "mcpServers"/);
  });

  it("succeeds for a valid config with mcpServers", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-test-"));
    const file = join(dir, "good.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] } } }));
    const result = discoverConfigFiles(file);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("Custom path");
    expect(Object.keys(result[0].servers)).toEqual(["fs"]);
  });

  it("also accepts the 'servers' key as an alias for 'mcpServers'", () => {
    dir = mkdtempSync(join(tmpdir(), "tollbooth-test-"));
    const file = join(dir, "alias.json");
    writeFileSync(file, JSON.stringify({ servers: { fs: { command: "npx", args: ["-y", "server-x"] } } }));
    const result = discoverConfigFiles(file);
    expect(Object.keys(result[0].servers)).toEqual(["fs"]);
  });
});
