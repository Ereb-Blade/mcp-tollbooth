import type { GithubRepoInfo, PackageInfo, RawMcpServerConfig, ServerKind } from "./types.js";

const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";

/**
 * Fallback GitHub repo for packages whose npm registry metadata is missing (or
 * inconsistent about) a `repository` field. Verified by hand against the live
 * registry — several official @modelcontextprotocol/* packages simply don't
 * publish this field even though they live in a real, well-known monorepo, and
 * without this map their trust score always reads "no repo found" regardless of
 * how well-maintained the actual project is.
 */
const KNOWN_SERVER_REPOS: Record<string, string> = {
  "@modelcontextprotocol/server-github": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-slack": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-postgres": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-puppeteer": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-brave-search": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-google-maps": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-everart": "https://github.com/modelcontextprotocol/servers",
  "@modelcontextprotocol/server-redis": "https://github.com/modelcontextprotocol/servers",
  "@cloudflare/mcp-server-cloudflare": "https://github.com/cloudflare/mcp-server-cloudflare",
};

/**
 * Repo fallback for known **uvx/pipx** (PyPI) packages only. Deliberately kept
 * separate from KNOWN_SERVER_REPOS above: "mcp-server-fetch" and
 * "mcp-server-sqlite" are real PyPI package names, but those exact strings are
 * ALSO squattable (or already squatted — see e.g. the "npx confusion" security
 * research canary published to npm under the literal name "mcp-server-fetch").
 * If a config invokes a same-named package via `npx` instead of `uvx`, it is a
 * *different* package in a *different* registry, and must never inherit this
 * trust/repo mapping. Kind separation in classifyServer() is what keeps these
 * two lookups from colliding.
 */
export const KNOWN_UVX_SERVER_REPOS: Record<string, string> = {
  "mcp-server-fetch": "https://github.com/modelcontextprotocol/servers",
  "mcp-server-sqlite": "https://github.com/modelcontextprotocol/servers",
};

/** Figures out roughly what kind of server this is, and pulls out an npm package name if present. */
export function classifyServer(cfg: RawMcpServerConfig): { kind: ServerKind; packageName?: string; rawCommandLine: string } {
  if (cfg.url) {
    return { kind: "remote-http", rawCommandLine: `${cfg.transport ?? "http"} ${cfg.url}` };
  }

  const command = cfg.command ?? "";
  const args = cfg.args ?? [];
  const rawCommandLine = [command, ...args].join(" ").trim();

  if (command === "npx") {
    // npx -y <package> [...rest]   — first non-flag arg after -y is the package
    const pkg = args.find((a) => !a.startsWith("-"));
    if (pkg) {
      return { kind: "npx-package", packageName: stripVersion(pkg), rawCommandLine };
    }
  }

  if (command === "uvx" || command === "pipx") {
    // Separate kind from npx: uvx/pipx pull from PyPI, not npm. Same package-name
    // string can refer to two completely unrelated packages across the two
    // registries (see the KNOWN_UVX_SERVER_REPOS comment), so these must never
    // be looked up against the npm registry as if they were npx packages.
    const pkg = args.find((a) => !a.startsWith("-"));
    if (pkg) {
      return { kind: "uvx-package", packageName: stripVersion(pkg), rawCommandLine };
    }
  }

  if (command) {
    return { kind: "local-binary", rawCommandLine };
  }

  return { kind: "unknown", rawCommandLine: rawCommandLine || "(no command)" };
}

/** Strips a trailing "@version" pin from an npx-style package spec, respecting scoped packages (@scope/name@version). */
function stripVersion(pkg: string): string {
  const searchFrom = pkg.startsWith("@") ? 1 : 0;
  const atIndex = pkg.indexOf("@", searchFrom);
  return atIndex === -1 ? pkg : pkg.slice(0, atIndex);
}

function parseGithubUrl(url: string | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  const cleaned = url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export async function fetchNpmPackageInfo(packageName: string): Promise<PackageInfo | null> {
  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(packageName)}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const latestVersion = data["dist-tags"]?.latest;
    const versionData = latestVersion ? data.versions?.[latestVersion] : undefined;
    const repository = versionData?.repository ?? data.repository;
    const repoUrl =
      (typeof repository === "string" ? repository : repository?.url) ??
      KNOWN_SERVER_REPOS[packageName];
    return {
      name: packageName,
      version: latestVersion,
      repositoryUrl: repoUrl,
    };
  } catch {
    return null;
  }
}

export type GithubLookupResult =
  | { status: "found"; info: GithubRepoInfo }
  | { status: "not-found" }
  | { status: "rate-limited" }
  | { status: "error" };

export async function fetchGithubRepoInfo(repoUrl: string | undefined): Promise<GithubLookupResult> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) return { status: "not-found" };

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "mcp-tollbooth",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`, { headers });

    if (res.status === 404) return { status: "not-found" };
    if (res.status === 403 || res.status === 429) {
      // GitHub distinguishes rate-limit from auth-scope 403s via this header.
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0" || res.status === 429) return { status: "rate-limited" };
      return { status: "error" };
    }
    if (!res.ok) return { status: "error" };

    const data: any = await res.json();
    const pushedAt: string = data.pushed_at;
    const daysSinceLastPush = Math.floor(
      (Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      status: "found",
      info: {
        owner: parsed.owner,
        repo: parsed.repo,
        stars: data.stargazers_count ?? 0,
        openIssues: data.open_issues_count ?? 0,
        archived: Boolean(data.archived),
        hasLicense: Boolean(data.license),
        daysSinceLastPush,
        pushedAt,
      },
    };
  } catch {
    return { status: "error" };
  }
}
