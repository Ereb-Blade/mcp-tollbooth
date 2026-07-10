# MCP Tollbooth

[![npm version](https://img.shields.io/npm/v/mcp-tollbooth.svg)](https://www.npmjs.com/package/mcp-tollbooth)
[![npm downloads](https://img.shields.io/npm/dw/mcp-tollbooth.svg)](https://www.npmjs.com/package/mcp-tollbooth)
[![CI](https://github.com/Ereb-Blade/mcp-tollbooth/actions/workflows/ci.yml/badge.svg)](https://github.com/Ereb-Blade/mcp-tollbooth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mcp-tollbooth.svg)](./LICENSE)

**How much context window are your MCP servers actually costing you — and are any of them doing the same job twice?**

MCP Tollbooth scans your local [Model Context Protocol](https://modelcontextprotocol.io) configuration (Claude Desktop, Claude Code, Cursor, VS Code) and answers two questions nobody else is answering well:

-  **Token budget** — how many tokens each server silently costs you before your agent does anything useful, and what the total toll is across your whole setup
-  **Overlap detection** — do you have three different servers all fighting to do "GitHub stuff"? Pick one, save the budget.
-  A lightweight **trust signal** (repo activity, stars, license) as a secondary check, clearly labeled as a heuristic — not a security scanner

## Why this, and not a security scanner

By mid-2026 the MCP ecosystem has real security tooling already: [`@wigu/mcp-doctor`](https://www.npmjs.com/package/@wigu/mcp-doctor) does secret-leak and permission scanning with a GitHub Action; other tools do agent-friendliness diagnostics. That space is getting crowded, and doing it shallowly wouldn't add much.

What's still missing is the boring-but-real cost problem: **every server you add eats context before your agent types a word.** A handful of servers can burn 50,000+ tokens of budget, and most people have no idea which ones are the expensive ones — or that they've installed the same capability twice under two different names. Tollbooth answers exactly that, and nothing more than that, well.

## Install & use

```bash
npx mcp-tollbooth
```

No install, no config. It scans the standard locations:

- `.mcp.json` (Claude Code, project-scoped)
- `~/.claude.json` (Claude Code, user-scoped)
- `claude_desktop_config.json` (Claude Desktop — macOS/Windows/Linux paths)
- `.cursor/mcp.json` and `~/.cursor/mcp.json` (Cursor)
- `.vscode/mcp.json` (VS Code)

Or point it at a specific file:

```bash
npx mcp-tollbooth --config ./my-config.json
```

Raw JSON for scripting / CI:

```bash
npx mcp-tollbooth --json
```

### CI: fail a build over budget

```bash
npx mcp-tollbooth --config .mcp.json --max-tokens 20000
```

Exits `1` if the total estimated toll goes over the number you set — nothing to parse, just a pass/fail gate. Or use the bundled GitHub Action directly:

```yaml
- uses: Ereb-Blade/mcp-tollbooth@main
  with:
    config: .mcp.json
    max-tokens: 20000
```

### Example output

```
  MCP Tollbooth  — what your MCP servers are costing your context window

Scanned config files:
  • Claude Code (project .mcp.json) (/you/project/.mcp.json) — 5 server(s)

┌──────────────────┬────────────────────┬─────────────┬────────────┬───────────┬────────┐
│ Server           │ Category           │ Est. Tokens │ Trust*     │ Last Push │ Stars  │
├──────────────────┼────────────────────┼─────────────┼────────────┼───────────┼────────┤
│ playwright       │ browser-automation │ ~3,200      │ 95 Healthy │ 8d ago    │ 34,813 │
│ github           │ vcs                │ ~2,400      │ 60 Caution │ unknown   │ —      │
│ filesystem       │ filesystem         │ ~900        │ 95 Healthy │ 1d ago    │ 88,173 │
│ some-random-tool │ other              │ ~800*       │ 40 Risky   │ unknown   │ —      │
└──────────────────┴────────────────────┴─────────────┴────────────┴───────────┴────────┘

Overlap detected — you're paying twice for the same job:
  • vcs: github, some-other-git-tool — do you need all of these?

Total context toll: ~7,300 tokens  across 4 server(s)  ·  avg trust 72/100
```

## How it works

**Token estimates** for well-known servers are based on their documented tool counts. For everything else, Tollbooth falls back to a conservative heuristic based on the server's transport type — flagged with `*`, and clearly an *estimate, not a measurement*. Live connection mode (actually counting tool schemas) is on the roadmap.

**Overlap detection** groups servers by inferred category (vcs, filesystem, browser-automation, etc.) and flags any category with more than one server.

**Trust score** (0-100) is a secondary, clearly-labeled heuristic: official npm scope, days since last commit, GitHub stars, archived status, license presence. It is not a security scan — it doesn't read source code, run the server, or detect malicious behavior. If you want real security scanning, use a dedicated tool for that (see above).

## Limitations

- Token estimates for unlisted servers are heuristics, not measurements.
- GitHub/npm lookups depend on the package's `repository` field being accurate.
- Unauthenticated GitHub API calls are rate-limited — set `GITHUB_TOKEN` if auditing a lot of servers at once.

## Roadmap

- [x] GitHub Action for CI-time token-budget regression checks on team MCP configs (`--max-tokens`, `action.yml`)
- [ ] `--precise` live connection mode for exact token counts (connect and count real tool schemas)
- [ ] `--fix` mode to interactively disable low-value / redundant servers
- [ ] Per-server historical token trend (did that update just double your bill?)

## Development

```bash
npm install
npm run build
npm test        # builds first (pretest), then runs the vitest suite
npm run dev -- --config test-configs/demo.mcp.json   # run from source without building
```

CI runs the same build + test on every push/PR across Node 18/20/22 (see `.github/workflows/ci.yml`).

## Contributing

Issues and PRs welcome — especially the known-server token cost table in `src/heuristics.ts` and category keyword coverage.

## License

MIT
