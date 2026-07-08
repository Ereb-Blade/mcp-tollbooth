import type { Category } from "./types.js";

/**
 * Rough tool-count-derived token estimates for well-known MCP servers, based on
 * publicly documented tool counts (each tool definition costs roughly 150-400
 * tokens of context depending on schema complexity). These are estimates, not
 * measurements — use `--precise` in a future version to connect and measure directly.
 */
const KNOWN_SERVER_TOKEN_COSTS: Record<string, number> = {
  "@modelcontextprotocol/server-github": 2400,
  "@modelcontextprotocol/server-filesystem": 900,
  "@modelcontextprotocol/server-slack": 1200,
  "@modelcontextprotocol/server-postgres": 800,
  "@modelcontextprotocol/server-puppeteer": 1400,
  "@modelcontextprotocol/server-brave-search": 500,
  "@modelcontextprotocol/server-memory": 400,
  "@modelcontextprotocol/server-everything": 2000,
  "@modelcontextprotocol/server-sequential-thinking": 300,
  "@modelcontextprotocol/server-google-maps": 900,
  "@modelcontextprotocol/server-everart": 500,
  "@playwright/mcp": 3200,
  "firecrawl-mcp": 1600,
  "@notionhq/notion-mcp-server": 2800,
  "figma-developer-mcp": 1800,
  "@upstash/context7-mcp": 600,
  "@sentry/mcp-server": 1100,
  "mcp-server-linear": 1300,
  "@modelcontextprotocol/server-redis": 600,
  "mongodb-mcp-server": 1500,
  "@supabase/mcp-server-supabase": 1400,
  "@cloudflare/mcp-server-cloudflare": 1900,
  // NOTE: "stripe-mcp" isn't a real package — Stripe's official npm package is
  // "@stripe/mcp" (repo: stripe/ai). "@asana/mcp-server" was dropped entirely:
  // Asana's official MCP is remote-only (OAuth via mcp.asana.com), not something
  // that shows up as an npx entry in a local config, so a hardcoded cost for it
  // was never going to match anything real.
  "@stripe/mcp": 1700,
};

/**
 * Known costs for uvx/pipx (PyPI) packages, kept in a separate table keyed by
 * the *same string space* as KNOWN_SERVER_TOKEN_COSTS above — but never merged
 * with it. "mcp-server-fetch" invoked via npx is a different, unrelated package
 * (an npm-namesquat) from "mcp-server-fetch" invoked via uvx (the real PyPI
 * tool); estimateTokens() below picks the right table based on `kind` so an
 * npx-invoked squat can never inherit the trusted PyPI package's numbers.
 */
const KNOWN_UVX_TOKEN_COSTS: Record<string, number> = {
  "mcp-server-fetch": 350,
  "mcp-server-sqlite": 700,
};

/**
 * Category keywords are matched as whole tokens against the server/package name,
 * split on non-alphanumeric characters — NOT as loose substrings. Substring
 * matching previously caused false positives like "digital-ocean" -> vcs (via
 * "git" inside "digital"), "research-helper" -> search-web (via "search" inside
 * "research"), and "example-mcp" -> search-web (via "exa" inside "example").
 */
const CATEGORY_KEYWORDS: [string[], Category][] = [
  [["github", "gitlab", "bitbucket", "git"], "vcs"],
  [["filesystem", "fs"], "filesystem"],
  [["playwright", "puppeteer", "browserbase", "browser"], "browser-automation"],
  [["postgres", "postgresql", "sqlite", "mysql", "mongo", "mongodb", "supabase", "dynamodb", "neon", "redis"], "database"],
  [["brave", "search", "exa", "perplexity", "firecrawl"], "search-web"],
  [["notion", "confluence", "obsidian", "docs", "context7", "drive"], "docs-knowledge"],
  [["linear", "jira", "asana", "monday", "trello"], "project-management"],
  [["slack", "discord", "teams", "email", "gmail"], "communication"],
  [["figma", "framer", "webflow", "design"], "design"],
  [["stripe", "payment", "payments"], "payments"],
  [["aws", "cloudflare", "azure", "gcp", "terraform"], "cloud-infra"],
  [["datadog", "sentry", "last9", "observability", "logs"], "observability"],
];

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

export function estimateTokens(packageName: string | undefined, kind: string): {
  tokens: number;
  confidence: "known" | "heuristic";
} {
  if (packageName) {
    const table = kind === "uvx-package" ? KNOWN_UVX_TOKEN_COSTS : KNOWN_SERVER_TOKEN_COSTS;
    if (table[packageName] !== undefined) {
      return { tokens: table[packageName], confidence: "known" };
    }
  }

  // Heuristic fallback by server "shape"
  if (kind === "remote-http") return { tokens: 1500, confidence: "heuristic" };
  if (kind === "local-binary") return { tokens: 1000, confidence: "heuristic" };
  if (kind === "uvx-package") return { tokens: 700, confidence: "heuristic" };
  return { tokens: 800, confidence: "heuristic" };
}

export function categorize(name: string, packageName?: string): Category {
  const tokens = tokenize(`${name} ${packageName ?? ""}`);
  for (const [keywords, category] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => tokens.has(k))) return category;
  }
  return "other";
}
