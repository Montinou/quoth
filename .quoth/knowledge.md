# Knowledge

General context and learnings for this project.

## Project Identity

Quoth is a two-tier AI Memory & Self-Learning platform:
1. **Cloud Platform** — Next.js 16, React 19, Neon PostgreSQL (Drizzle ORM), Clerk auth, deployed at https://quoth.triqual.dev
2. **Claude Code Plugin** (v3.2.0) — 22 MCP tools, self-learning daemon, SQLite + HNSW

## Key Numbers

- Cloud: 18 MCP tools, 6 DB schemas, 30+ tables, 6 migrations
- Plugin: 22 MCP tools (patterns 8, agents 6, intelligence 6, skills 2)
- RAG pipeline: text-embedding-3-large (2000d) via Vercel AI Gateway, Cohere reranking
- Auth: Clerk (web), custom JWT (MCP API keys, SHA256 hashed, 90-day expiry)
- Design: "Intellectual Neo-Noir" — obsidian/charcoal/violet palette, Cinzel + Geist fonts

## Genesis Documentation

Comprehensive Genesis (11 docs) completed 2026-01-29:
- architecture/: project-overview, tech-stack, repo-structure
- patterns/: coding-conventions, testing-patterns, error-handling, security-patterns
- contracts/: api-schemas, database-models, shared-types
- meta/: tech-debt
