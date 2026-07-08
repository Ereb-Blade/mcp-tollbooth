export interface RawMcpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  transport?: string;
  env?: Record<string, string>;
}

export interface DiscoveredConfigFile {
  source: string; // human readable label, e.g. "Claude Desktop (macOS)"
  path: string;
  servers: Record<string, RawMcpServerConfig>;
}

export type ServerKind = "npx-package" | "remote-http" | "local-binary" | "unknown";

export interface PackageInfo {
  name?: string;
  version?: string;
  repositoryUrl?: string;
}

export interface GithubRepoInfo {
  owner: string;
  repo: string;
  stars: number;
  openIssues: number;
  archived: boolean;
  daysSinceLastPush: number;
  hasLicense: boolean;
  pushedAt: string;
}

export type Category =
  | "vcs"
  | "filesystem"
  | "browser-automation"
  | "database"
  | "search-web"
  | "docs-knowledge"
  | "project-management"
  | "communication"
  | "design"
  | "payments"
  | "cloud-infra"
  | "observability"
  | "other";

export interface ServerAudit {
  configSource: string;
  serverName: string;
  kind: ServerKind;
  rawCommandLine: string;
  packageInfo?: PackageInfo;
  githubInfo?: GithubRepoInfo | null;
  category: Category;
  estimatedTokens: number;
  tokenConfidence: "known" | "heuristic";
  trustScore: number; // 0-100
  trustNotes: string[];
}

export interface AuditReport {
  servers: ServerAudit[];
  totalEstimatedTokens: number;
  overallScore: number;
  overlapGroups: { category: Category; serverNames: string[] }[];
  warnings: string[];
}
