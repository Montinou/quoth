# Quoth — Technical Documentation

> Version 3.3.0 | Last updated: 2026-04-08

Quoth is a two-part system: a **Claude Code plugin** (`quoth-plugin/`) that provides autonomous self-learning, intelligence routing, and agent coordination locally, and a **SaaS platform** (`src/`) deployed on Vercel that serves as the cloud knowledge base, agent registry, and search API.

## Table of Contents

### Architecture

| Document | Description |
|----------|-------------|
| [01 — System Overview](./01-system-overview.md) | High-level architecture, two-part design, data flow |
| [02 — Plugin Architecture](./02-plugin-architecture.md) | quoth-plugin directory structure, module map |
| [03 — SaaS Platform](./03-saas-platform.md) | Next.js app, API routes, database schemas |

### Plugin Subsystems

| Document | Description |
|----------|-------------|
| [04 — Hook System](./04-hook-system.md) | All 9 hook bindings, dispatch flow, context injection, trajectory capture |
| [05 — Daemon & Pipeline](./05-daemon-pipeline.md) | Background processor, JUDGE → DISTILL → CONSOLIDATE |
| [06 — MCP Server & Tools](./06-mcp-tools.md) | 22 MCP tools across 4 handler modules |
| [07 — Intelligence Graph](./07-intelligence-graph.md) | PageRank, trigram matching, context ranking |
| [08 — Confidence Scoring](./08-confidence-scoring.md) | Bayesian Beta model, decay, feedback loops |
| [09 — Task Routing](./09-task-routing.md) | Keyword matching, agent capabilities, alternatives |

### Data & Storage

| Document | Description |
|----------|-------------|
| [10 — Local Database (SQLite)](./10-local-database.md) | Schema, HNSW index, pattern lifecycle |
| [11 — Cloud Database (Neon)](./11-cloud-database.md) | 6 Postgres schemas, Drizzle ORM, vector search |
| [12 — Embeddings & Search](./12-embeddings-search.md) | Local MiniLM-L6-v2 (384d), cloud voyage-4-lite (1024d), HNSW, cosine similarity |

### Operations

| Document | Description |
|----------|-------------|
| [13 — Setup & Installation](./13-setup-installation.md) | setup.sh, symlinks, settings.json injection, skill-registry sync |
| [14 — Cloud Sync & Promotion](./14-cloud-sync.md) | Pattern promotion, nightly consolidation, Quoth API |
| [15 — Agent Coordination](./15-agent-coordination.md) | Registry, heartbeats, task assignment, events |
| [16 — Security Model](./16-security-model.md) | Auth (Clerk + agent keys), rate limiting, OAuth 2.1 |

### Plugin Extensions (v3.3.0)

| Document | Description |
|----------|-------------|
| [20 — Context Injection & Skills](./20-context-skills.md) | Project context files, session-start injection, 9 built-in skills |
| [21 — V2 Subsystems](./21-v2-subsystems.md) | Thompson sampling, clustering, propensity, SNIPS, curation, attribution |

### Reference

| Document | Description |
|----------|-------------|
| [17 — API Reference](./17-api-reference.md) | REST API endpoints, cron jobs (MCP tools → doc 06) |
| [18 — Configuration](./18-configuration.md) | Environment variables, plugin.json, hooks.json |
| [19 — Testing](./19-testing.md) | Test suite, Vitest config, coverage |

---

## Quick Links

- **Plugin entry point:** `quoth-plugin/mcp/quoth-learning-server.js`
- **Daemon:** `quoth-plugin/daemon/daemon.js`
- **Hook dispatcher:** `quoth-plugin/hooks/hook-dispatch.js`
- **Cloud app:** `src/app/` (Next.js App Router)
- **DB schema:** `src/db/schema.ts` (Drizzle ORM)
- **Tests:** `quoth-plugin/tests/` + `tests/`
