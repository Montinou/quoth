# Quoth — AI Memory & Self-Learning Platform

> Persistent memory, autonomous learning, and agent coordination for AI-powered development

Quoth is a two-tier system:

1. **Cloud Platform** (Next.js SaaS) — Multi-tenant knowledge management with dashboard, API, search, and team collaboration
2. **Claude Code Plugin** (v3.2.0) — Local self-learning daemon that captures trajectories, learns patterns, routes tasks, and coordinates agents

## Architecture

```
Cloud Platform (src/)                    Plugin (quoth-plugin/)
├── Next.js 16 + React 19               ├── 22 MCP tools (stdio)
├── Neon PostgreSQL (Drizzle ORM)        ├── SQLite + HNSW (local)
├── Clerk authentication                 ├── Background daemon
├── Vercel AI Gateway embeddings         ├── Trajectory capture
│   (text-embedding-3-large, 2000d)      ├── Pattern learning (Haiku)
├── Cohere reranking                     ├── Intelligence routing
├── Cloud MCP server (/api/mcp)          └── Hook-based automation
└── Dashboard + API routes
```

## Cloud MCP Tools

Available via HTTP at `https://quoth.triqual.dev/api/mcp`:

| Tool | Description |
|------|-------------|
| `quoth_search_index` | Semantic search with text-embedding-3-large (2000d) + Cohere reranking |
| `quoth_read_doc` | Retrieve full document content by ID |
| `quoth_read_chunks` | Retrieve document chunks for granular access |
| `quoth_memory_store` | Store a memory entry for the current agent/session |
| `quoth_memory_search` | Semantic search over stored memories |
| `quoth_memory_list` | List stored memory entries |
| `quoth_memory_forget` | Delete a memory entry |
| `quoth_agent_register` | Register an agent in the project |
| `quoth_agent_list` | List registered agents |
| `quoth_agent_assign` | Assign an agent to a task |
| `quoth_agent_send_message` | Send a message to another agent |
| `quoth_agent_inbox` | Read an agent's inbox |
| `quoth_agent_tasks` | List tasks assigned to an agent |
| `quoth_agent_task_reassign` | Reassign a task to a different agent |
| `quoth_project_create` | Create a new Quoth project |
| `quoth_project_invite` | Invite a collaborator to a project |
| `quoth_token_generate` | Generate an MCP access token |
| `quoth_genesis` | Bootstrap project documentation (minimal/standard/comprehensive) |

## Plugin MCP Tools (22)

Available locally via stdio (`quoth-learning` server):

**Patterns (8):** `quoth_log_outcome`, `quoth_score_pattern`, `quoth_top_patterns`, `quoth_search_patterns`, `quoth_project_patterns`, `quoth_promote_global`, `quoth_seed_from_exolar`, `quoth_propose_update`

**Agents (6):** `quoth_daemon_status`, `quoth_ingest_trajectory`, `quoth_agent_register`, `quoth_agent_heartbeat`, `quoth_agent_list`, `quoth_assign_task`

**Intelligence (6):** `quoth_route_task`, `quoth_intelligence_init`, `quoth_intelligence_context`, `quoth_intelligence_consolidate`, `quoth_intelligence_stats`, `quoth_intelligence_feedback`

**Skills (2):** `quoth_extract_skill`, `quoth_list_skills`

## Plugin Hooks

All hooks run through a unified dispatcher (`hook-dispatch.js`). Zero API calls in automatic hooks.

| Hook Event | What It Does |
|---|---|
| `UserPromptSubmit` | Route task to optimal agent, show relevant patterns |
| `SessionStart` | Init intelligence graph, inject top patterns (>= 0.6 confidence) |
| `SessionEnd` | Consolidate intelligence graph, recompute PageRank |
| `PreCompact` | Same as SessionEnd (pre-context-compression) |
| `PostToolUse (Write/Edit)` | Record edit for intelligence |
| `PostToolUse (Bash/Write/Edit/Agent)` | Capture tool calls to trajectory file |
| `PreToolUse (Bash)` | Block dangerous commands |
| `SubagentStart` | Inject domain-relevant patterns via additionalContext |
| `SubagentStop` | Implicit positive feedback to intelligence |

## Installation

### Cloud MCP Server

```bash
claude mcp add --transport http quoth https://quoth.triqual.dev/api/mcp
```

### Plugin (Full Self-Learning)

```bash
cd quoth-plugin && bash scripts/setup.sh
```

Symlinks hooks to `~/.quoth/hooks/`, injects hook declarations into `~/.claude/settings.json`, and adds MCP server config. Idempotent.

## Team Collaboration

- **Multi-user projects** — Share knowledge bases with team members
- **Role-based access** — Admin, Editor, and Viewer roles
- **Email invitations** — Invite collaborators via secure tokens

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLERK_SECRET_KEY` | Clerk authentication secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client-side) |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway — text-embedding-3-large (2000d) |
| `JWT_SECRET` | MCP token generation |
| `RESEND_API_KEY` | Email delivery (optional) |
| `QUOTH_API_KEY` | Plugin cloud sync (qth_* key) |

## Build & Test

```bash
npm run build    # Build Next.js app
npm test         # Run Vitest tests
npm run lint     # ESLint
```

## Links

- **Website**: https://quoth.triqual.dev
- **Documentation**: https://quoth.triqual.dev/docs
- **Changelog**: https://quoth.triqual.dev/changelog

## License

MIT
