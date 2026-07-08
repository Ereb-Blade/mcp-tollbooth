import type { GithubRepoInfo, PackageInfo, RawMcpServerConfig, ServerKind } from "./types.js";

const NPM_REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";

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
    const pkg = args.find((a) => !a.startsWith("-"));
    if (pkg) {
      return { kind: "npx-package", packageName: stripVersion(pkg), rawCommandLine };
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
    const repoUrl = typeof repository === "string" ? repository : repository?.url;
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
