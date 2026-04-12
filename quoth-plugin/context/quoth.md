# Quoth — Project Context

Self-learning platform for AI agents. Two components: local Claude Code
plugin (`quoth-plugin/`) and SaaS cloud (`src/`, Next.js 16 on Vercel at
quoth.triqual.dev).

For the authoritative v3.6 architecture, pipeline stages, MCP tool
surface, database schema, and hook wiring, see:

- `quoth-plugin/CLAUDE.md` — plugin runtime + operational notes
- `docs/superpowers/specs/2026-04-11-session-capture-and-pattern-extraction-design.md`
  — design spec for the knowledge-entities pipeline
