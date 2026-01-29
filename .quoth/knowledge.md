# Knowledge

General context and learnings for this project.

## Project Identity

Quoth v2.0 is an AI Memory system built with Next.js 16, React 19, Supabase, and MCP Protocol. Production at https://quoth.ai-innovation.site. Multi-tenant with RLS, project-based isolation.

## Key Numbers

- 33 API routes, 31 DB migrations, 13 MCP modules, 35 React components
- 9 MCP tools registered in `src/lib/quoth/tools.ts`
- RAG pipeline: 512d vectors, fetch 50 candidates, rerank to top 15
- Auth: 90-day API key expiration, SHA256 hashed storage
- Design: "Intellectual Neo-Noir" — obsidian/charcoal/violet palette, Cinzel + Geist fonts

## Genesis Documentation

Comprehensive Genesis (11 docs) completed 2026-01-29:
- architecture/: project-overview, tech-stack, repo-structure
- patterns/: coding-conventions, testing-patterns, error-handling, security-patterns
- contracts/: api-schemas, database-models, shared-types
- meta/: tech-debt
