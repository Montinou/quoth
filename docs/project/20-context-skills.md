# Context Injection & Built-In Skills (v3.4.0)

Two subsystems added in v3.3.0 and extended in v3.4.0: a project context injection mechanism that enriches session start with relevant architecture summaries, and a set of built-in skills that ship with the plugin.

**Version:** 1.0.3 | **Last updated:** 2026-04-09

Source files:
- `quoth-plugin/context/` — context markdown files injected at SessionStart
- `quoth-plugin/hooks/hook-dispatch.js` — session-restore handler (context injection logic)
- `quoth-plugin/skills/` — built-in skill definitions
- `quoth-plugin/scripts/setup.sh` — skill-registry sync step

---

## Context Injection

### Purpose

The `session-restore` hook (SessionStart) can inject project-specific context directly into a Claude Code session's system context. This gives Claude immediate architectural awareness at conversation start without requiring the user to re-explain the codebase.

### How It Works

Context injection runs as part of the `session-restore` handler after the intelligence graph is initialized. It resolves the current project name and checks three file locations in order:

| Priority | Path | Condition |
|----------|------|-----------|
| 1 | `quoth-plugin/context/{project}.md` | Always checked first. If found, injected and marked as handled. |
| 2 | `quoth-plugin/context/project-summary.md` | Only if no project-specific file was found AND `project === 'quoth'`. |
| 3 | `{CLAUDE_PROJECT_DIR}/.quoth-context.md` | Always checked independently. Injected in addition to the above if present. |

The files are printed as plain markdown to stdout. Claude Code captures stdout from SessionStart hooks and injects it into the session system context.

### Context Files

**`quoth-plugin/context/quoth.md`** (project-specific)
- Full v3.2.0 architecture summary: local plugin + SaaS components
- All 9 hook bindings in a compact table
- Daemon pipeline details (JUDGE/DISTILL/CONSOLIDATE) with model names and temperatures
- Bayesian scoring formula, intelligence graph construction
- All 22 MCP tools grouped by category
- Database schemas (6 tables)
- HNSW parameters, task routing patterns, cloud promotion criteria
- Key paths reference

**`quoth-plugin/context/project-summary.md`**
- Identical content to `quoth.md` (acts as fallback for quoth project only)
- Used when the project resolves to `quoth` but no specific file is found by that name

### Doc Chunk Injection (UserPromptSubmit)

The `route` handler (UserPromptSubmit) performs a second form of context injection: semantic search over indexed documentation chunks. For every prompt of 10+ characters, the handler delegates to the daemon via a unified `route+inject` query over the Unix socket (`type: 'route+inject'`). The daemon generates the embedding and performs the doc chunk search; results are returned in `resp.doc_chunks`. Before the daemon query, the prompt is also persisted to `~/.quoth/intelligence/prompt-history.json` (rolling last 5, session-scoped). Chunks with cosine similarity > 0.2 are printed to stdout as:

```
[Quoth Docs] Relevant project context:
  • [label] Section Header: chunk content...
```

The label is derived from the doc filename (e.g., `docs/project/06-mcp-tools.md` → `mcp-tools`). Claude Code captures this stdout output and injects it into the session system context before the user prompt is processed. Only chunks above the 0.2 similarity threshold are shown; if no chunks qualify, nothing is printed.

### Doc Auto-Update Reporting (SessionStart)

The `session-restore` handler reads `~/.quoth/intelligence/doc-manifest.json` after context file injection and reports any doc auto-updates that haven't been shown yet. Updates are deduplicated by timestamp: only entries with `timestamp > lastReportedAt` are printed (up to 5). After reporting, `lastReportedAt` is updated so the same updates are not repeated in future sessions.

Example output:
```
[Quoth] 2 doc(s) auto-updated:
  - 06-mcp-tools.md → v1.2.3
  - 04-hook-system.md → v2.0.1
```

The `doc-manifest.json` file is written by the daemon's doc auto-update pipeline; `session-restore` is read-only with respect to the manifest (except for updating `lastReportedAt`).

### Context-Aware Pattern Injection (SessionStart)

After reporting doc updates, `session-restore` performs a final daemon-based pattern injection informed by the previous session's context. It loads `~/.quoth/intelligence/last-context-{project}.json` (written by `session-end`) and builds a query string from the last 2 prompts and top 5 topics. If no prior context is available, it falls back to `"session start"`.

The daemon is queried with `{ type: 'inject', limit: 7 }` and matching patterns are printed:

```
[Quoth] N patterns loaded for project "my-project":
- [0.82] pattern-name: action description...
```

Pattern IDs are recorded via `recordExposure()` and `session-memory.js` so that `session-end` can apply the appropriate feedback (V1 soft-negative on stale injections, V2 reward-weighted via `injection_log`). The `last-context-{project}.json` snapshot itself is written by `session-end` from the `createSessionMemory` summary.

### Project-Local Context Override

Any project can provide its own context file at `.quoth-context.md` in the project root. This is useful for projects that are not the quoth repo itself but want context injection. This file is injected in addition to (not instead of) any plugin-bundled context.

Example `.quoth-context.md`:
```markdown
# my-project — Session Context

## Architecture
Next.js 16 app. PostgreSQL + Drizzle. Deployed on Vercel.

## Key conventions
- All DB queries go through src/lib/db/
- Auth via Clerk, userId from auth() in server components
```

### Adding New Project Contexts

To add a context file for a new project (e.g., `sales-companion`):

1. Create `quoth-plugin/context/sales-companion.md`
2. Write a compact architecture summary (under 100 lines is ideal)
3. Re-run `bash quoth-plugin/scripts/setup.sh` is not required — the file is read at session start

The project name is resolved via `resolveProjectName()` in `hook-dispatch.js`, which tries the following in order:

1. **Git remote origin** — runs `git remote get-url origin` in `CLAUDE_PROJECT_DIR` and extracts the repository name from the URL (e.g., `Montinou/sales-companion.git` → `sales-companion`). Result is lowercased.
2. **OpenClaw workspace path** — if the directory matches `/.openclaw/workspaces/{name}/repo/`, uses `{name}`.
3. **Parent dirname** — if the directory basename is `repo` or `src`, uses the parent directory name.
4. **Directory basename** — fallback to the current directory name.

---

## Built-In Skills

### Overview

`quoth-plugin/skills/` contains nine skill definitions that ship with the plugin. These are `.claude-plugin`-style skills in YAML-fronted markdown — each has a `SKILL.md` with metadata and instructions.

On setup, if `~/projects/skill-registry` exists and `bun` is available, `setup.sh` runs `bun run sync:quoth` to publish these skills to the external skill-registry, making them available globally via Stitch MCP.

### Skill Definitions

| Skill | Name | Trigger | Purpose |
|-------|------|---------|---------|
| `bayesian-confidence/` | `bayesian-confidence` | User-invocable | Beta-Bernoulli confidence tracking with empirical Bayes cold-start and exponential forgetting |
| `contextual-bandits/` | `contextual-bandits` | User-invocable | Hierarchical Thompson sampling with cluster-level posteriors + SNIPS counterfactual updates |
| `knowledge-base-curation/` | `knowledge-base-curation` | User-invocable | Anti-bloat curation for learned knowledge bases — quality gates, dedup, retirement, staleness |
| `learn/` | `learn` | `/quoth:learn` | Trigger immediate pattern consolidation — sends SIGUSR1 to daemon, shows updated patterns |
| `llm-as-judge/` | `llm-as-judge` | User-invocable | Pairwise LLM-as-judge evaluation with position randomization and active learning |
| `patterns/` | `patterns` | `/quoth:patterns` | Browse the confidence-scored pattern library, highlight promotion candidates |
| `quoth-genesis/` | `quoth-genesis` | User-invocable | Deep codebase analyzer that generates complete technical documentation in `docs/project/` |
| `quoth-help/` | `quoth-help` | `/quoth-help [topic]` | In-session documentation for all quoth subsystems (tools, hooks, daemon, cloud, troubleshooting) |
| `quoth-init/` | `quoth-init` | User-invocable | Initialize project-local Quoth memory (`.quoth/` folder with config.json and type files) |

### quoth-genesis

The genesis skill guides an agent through four phases:

1. **Discovery** — list source files, read entry points, map directories to subsystems, check existing `docs/project/`
2. **Deep Analysis & Generation** — for each planned doc: read all relevant source files, extract schemas/APIs/config/algorithms, write numbered markdown docs
3. **README Index** — generate `docs/project/README.md` with categorized table of contents
4. **Context File (Optional)** — generate `quoth-plugin/context/{project}.md` or `.quoth-context.md` for session-start injection

Quality rules enforced: 100-400 lines per doc, tables over prose for structured data, exact values from source code, source file references on every doc.

For large projects, the skill instructs spawning sub-agents in parallel (frontend/UI docs, backend/API docs, database/schema docs).

### learn

Sends `SIGUSR1` to the daemon PID (via `kill -USR1 $(cat ~/.quoth/daemon.pid)`) to trigger immediate trajectory processing. Checks daemon status first via `quoth_daemon_status`. Shows updated top-10 patterns after a 5-second wait.

### patterns

Calls `quoth_top_patterns({ limit: 20 })` and presents patterns sorted by confidence. Highlights:
- Patterns with confidence > 0.8 (cloud promotion candidates)
- Patterns with confidence < 0.2 (archival candidates)

Offers follow-up: "Run `/learn` to trigger manual consolidation".

### quoth-help

Interactive documentation hub. Called with an optional topic argument. Valid topics:

| Topic | Content |
|-------|---------|
| (none) | Overview: quick start, available topics |
| `tools` | All 22 MCP tools listed by category |
| `hooks` | All 9 hook events with descriptions |
| `daemon` | Pipeline overview, storage paths, confidence scoring |
| `skills` | Available skills and their invocation |
| `cloud` | Cloud MCP server setup + all cloud tools |
| `troubleshooting` | Common problems and fixes |

### quoth-init

Initializes project-local Quoth memory with an interactive configuration workflow:

1. Check if `.quoth/` already exists
2. Ask user for: strictness level (blocking/reminder/off), knowledge types (decisions/patterns/errors/knowledge/selectors/api), gates (require_reasoning_before_edit, require_quoth_search, require_error_documentation)
3. Create `.quoth/config.json` with version 3.4.0 + user choices
4. Create type files (`.quoth/{type}.md`) with formatted templates
5. Add `.quoth/sessions/` to `.gitignore`

This skill creates project-local `.quoth/` folders (distinct from the global `~/.quoth/` runtime). The local config controls per-project strictness and knowledge capture behavior.

### Skill Registry Sync

The `setup.sh` step 5 runs:

```bash
QUOTH_SKILLS_DIR="$PLUGIN_DIR/skills" bun run sync:quoth
```

From within `~/projects/skill-registry`. This publishes or updates the nine skills in the registry so they are accessible via Stitch MCP in any Claude Code session or OpenClaw workspace.

If skill-registry is not present or bun is unavailable, setup continues without error and prints the manual sync command.

---

Cross-references: [04 — Hook System](./04-hook-system.md) | [13 — Setup & Installation](./13-setup-installation.md) | [02 — Plugin Architecture](./02-plugin-architecture.md)
