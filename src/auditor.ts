import { categorize, estimateTokens } from "./heuristics.js";
import { classifyServer, fetchGithubRepoInfo, fetchNpmPackageInfo, KNOWN_UVX_SERVER_REPOS } from "./registryInfo.js";
import type { GithubLookupResult } from "./registryInfo.js";
import type { AuditReport, DiscoveredConfigFile, RawMcpServerConfig, ServerAudit } from "./types.js";

const OFFICIAL_SCOPES = ["@modelcontextprotocol", "@anthropic-ai", "@upstash", "@notionhq", "@playwright"];

function computeTrustScore(params: {
  githubLookup: GithubLookupResult | undefined;
  kind: string;
  packageName?: string;
}): { score: number; notes: string[]; rateLimited: boolean } {
  const notes: string[] = [];
  let score = 50; // neutral baseline

  const { githubLookup, kind, packageName } = params;

  if (kind === "unknown") {
    notes.push("Could not determine how this server runs — treat as untrusted until verified manually.");
    return { score: 20, notes, rateLimited: false };
  }

  if (packageName && OFFICIAL_SCOPES.some((scope) => packageName.startsWith(scope))) {
    score += 20;
    notes.push("Published under a recognized official/vendor npm scope.");
  }

  if (githubLookup?.status === "rate-limited") {
    notes.push("GitHub rate limit hit — repo activity/stars not verified this run (set GITHUB_TOKEN).");
    return { score: clamp(score), notes, rateLimited: true };
  }

  if (githubLookup?.status === "error") {
    notes.push("Could not reach GitHub to verify repo activity — network or API error.");
    return { score: clamp(score), notes, rateLimited: false };
  }

  if (!githubLookup || githubLookup.status === "not-found") {
    notes.push("No public GitHub repo found — could not verify maintenance status.");
    score -= 10;
    return { score: clamp(score), notes, rateLimited: false };
  }

  const githubInfo = githubLookup.info;

  if (githubInfo.archived) {
    score -= 40;
    notes.push("Repository is archived — no further security fixes expected.");
  }

  if (githubInfo.daysSinceLastPush > 365) {
    score -= 25;
    notes.push(`No commits in ${Math.floor(githubInfo.daysSinceLastPush / 30)}+ months — likely unmaintained.`);
  } else if (githubInfo.daysSinceLastPush > 180) {
    score -= 10;
    notes.push(`Last commit was ${Math.floor(githubInfo.daysSinceLastPush / 30)} months ago.`);
  } else {
    score += 10;
    notes.push("Actively maintained (commit within the last 6 months).");
  }

  if (githubInfo.stars >= 1000) {
    score += 15;
    notes.push(`Well-established: ${githubInfo.stars.toLocaleString()} GitHub stars.`);
  } else if (githubInfo.stars < 20) {
    score -= 10;
    notes.push(`Low visibility: only ${githubInfo.stars} GitHub stars — limited community scrutiny.`);
  }

  if (!githubInfo.hasLicense) {
    score -= 10;
    notes.push("No OSS license detected on the repo.");
  }

  return { score: clamp(score), notes, rateLimited: false };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function auditConfigFiles(configFiles: DiscoveredConfigFile[]): Promise<AuditReport> {
  const warnings: string[] = [];

  const jobs: { file: DiscoveredConfigFile; serverName: string; rawCfg: RawMcpServerConfig }[] = [];
  for (const file of configFiles) {
    for (const [serverName, rawCfg] of Object.entries(file.servers)) {
      jobs.push({ file, serverName, rawCfg });
    }
  }

  const results = await Promise.all(
    jobs.map(async ({ file, serverName, rawCfg }): Promise<ServerAudit & { rateLimited: boolean }> => {
      const { kind, packageName, rawCommandLine } = classifyServer(rawCfg);

      let packageInfo;
      let githubLookup: GithubLookupResult | undefined;

      if (packageName && kind === "npx-package") {
        packageInfo = (await fetchNpmPackageInfo(packageName)) ?? { name: packageName };
        githubLookup = await fetchGithubRepoInfo(packageInfo.repositoryUrl);
      } else if (packageName && kind === "uvx-package") {
        // No PyPI metadata fetcher yet — only cross-check against the known-good
        // PyPI repo map (never the npm one; see KNOWN_UVX_SERVER_REPOS comment).
        packageInfo = { name: packageName };
        const knownRepo = KNOWN_UVX_SERVER_REPOS[packageName];
        githubLookup = knownRepo ? await fetchGithubRepoInfo(knownRepo) : { status: "not-found" };
      }

      const { tokens, confidence } = estimateTokens(packageName, kind);
      const category = categorize(serverName, packageName);
      const { score, notes } = computeTrustScore({ githubLookup, kind, packageName });

      return {
        configSource: file.source,
        serverName,
        kind,
        rawCommandLine,
        packageInfo,
        githubInfo: githubLookup?.status === "found" ? githubLookup.info : null,
        category,
        estimatedTokens: tokens,
        tokenConfidence: confidence,
        trustScore: score,
        trustNotes: notes,
        rateLimited: githubLookup?.status === "rate-limited",
      };
    })
  );

  const servers: ServerAudit[] = results.map(({ rateLimited, ...rest }) => rest);
  const anyRateLimited = results.some((r) => r.rateLimited);

  if (anyRateLimited) {
    warnings.push(
      "GitHub API rate limit was hit while checking repo activity — some trust scores are less precise this run. Set a GITHUB_TOKEN env var for higher limits."
    );
  }

  const totalEstimatedTokens = servers.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const overallScore = servers.length
    ? Math.round(servers.reduce((sum, s) => sum + s.trustScore, 0) / servers.length)
    : 100;

  // Overlap detection: same category, more than one server, excluding "other"
  const byCategory = new Map<string, string[]>();
  for (const s of servers) {
    if (s.category === "other") continue;
    const list = byCategory.get(s.category) ?? [];
    list.push(s.serverName);
    byCategory.set(s.category, list);
  }
  const overlapGroups = [...byCategory.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([category, serverNames]) => ({ category: category as ServerAudit["category"], serverNames }));

  if (totalEstimatedTokens > 40000) {
    warnings.push(
      `Your MCP servers use an estimated ~${totalEstimatedTokens.toLocaleString()} tokens of context before you type a single message. Consider trimming to your 3-5 most-used servers.`
    );
  }

  return { servers, totalEstimatedTokens, overallScore, overlapGroups, warnings };
}
