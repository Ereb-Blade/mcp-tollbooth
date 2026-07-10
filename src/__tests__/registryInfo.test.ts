import { describe, it, expect } from "vitest";
import { classifyServer } from "../registryInfo.js";

describe("classifyServer()", () => {
  it("extracts the package name from a standard npx invocation", () => {
    const result = classifyServer({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] });
    expect(result.kind).toBe("npx-package");
    expect(result.packageName).toBe("@modelcontextprotocol/server-filesystem");
  });

  it("strips a pinned version from an unscoped npx package", () => {
    const result = classifyServer({ command: "npx", args: ["-y", "some-tool@1.2.3"] });
    expect(result.packageName).toBe("some-tool");
  });

  it("strips a pinned version from a scoped npx package without breaking the scope", () => {
    const result = classifyServer({ command: "npx", args: ["-y", "@upstash/context7-mcp@1.0.0"] });
    expect(result.packageName).toBe("@upstash/context7-mcp");
  });

  it("classifies uvx invocations as uvx-package, separate from npx", () => {
    const result = classifyServer({ command: "uvx", args: ["mcp-server-fetch"] });
    expect(result.kind).toBe("uvx-package");
    expect(result.packageName).toBe("mcp-server-fetch");
  });

  it("classifies pipx invocations as uvx-package", () => {
    const result = classifyServer({ command: "pipx", args: ["some-python-server"] });
    expect(result.kind).toBe("uvx-package");
    expect(result.packageName).toBe("some-python-server");
  });

  it("strips versions for uvx packages too", () => {
    const result = classifyServer({ command: "uvx", args: ["mcp-server-fetch@0.3.0"] });
    expect(result.packageName).toBe("mcp-server-fetch");
  });

  // Regression: uvx/pipx with no package arg (only flags) used to fall into
  // npx-package with packageName: undefined instead of local-binary, unlike npx.
  it("falls back to local-binary when uvx/pipx has no package argument", () => {
    const result = classifyServer({ command: "uvx", args: ["-q"] });
    expect(result.kind).toBe("local-binary");
    expect(result.packageName).toBeUndefined();
  });

  it("falls back to local-binary when npx has no package argument", () => {
    const result = classifyServer({ command: "npx", args: ["-y"] });
    expect(result.kind).toBe("local-binary");
  });

  it("classifies a direct binary path as local-binary", () => {
    const result = classifyServer({ command: "/usr/local/bin/my-mcp-server" });
    expect(result.kind).toBe("local-binary");
    expect(result.packageName).toBeUndefined();
  });

  it("classifies a remote http/sse url as remote-http", () => {
    const result = classifyServer({ url: "https://mcp.example.com/sse", transport: "sse" });
    expect(result.kind).toBe("remote-http");
    expect(result.rawCommandLine).toContain("https://mcp.example.com/sse");
  });

  it("classifies an empty config as unknown", () => {
    const result = classifyServer({});
    expect(result.kind).toBe("unknown");
  });
});
