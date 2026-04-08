# Quoth Product Presentation — Context

## Topic
Complete product presentation for Quoth v3.4.0 — AI Memory & Self-Learning Platform

## Audience
Technical decision makers, developers, potential customers, investors

## Goal
Inform and persuade — showcase the full product capabilities, architecture, and value proposition

## Style (Selected)
- **Palette ID**: purple-dark-black-blue
- **Palette Name**: Purple Dark Black Blue
- **Mode**: dark
- **Style**: glass
- **Typography**:
  - Display: Sora
  - Body: Source Sans 3
  - Code: JetBrains Mono
- **User Keywords**: "AI, tech, modern, dark, purple"
- **Design Source**: palettes.md + custom Quoth branding

## Key Content Points
1. Problem: AI coding assistants have no memory, waste 20-30% of interactions
2. Solution: Two-part architecture (local plugin + cloud SaaS)
3. Learning loop: Automatic capture → LLM pipeline → Bayesian scoring → Cloud promotion
4. Plugin: 9 hooks, 22 MCP tools, background daemon, SQLite + HNSW
5. Daemon: JUDGE (Gemini 2.5 Flash batch) → DISTILL (Gemini 2.5 Flash Lite + MiniLM) → CONSOLIDATE (Claude Haiku 4.5)
6. Bayesian scoring: Beta(alpha, beta) distribution with exposure-based lifecycle
7. Intelligence graph: PageRank + trigram Jaccard similarity
8. Cloud: Next.js 16, Neon Postgres + pgvector, Clerk auth
9. Search: Vector + FTS + RRF + Reranking
10. Security: 4-layer auth, Zod validation, RFC 7807
11. Cost optimization: Gemini Flash (free tier) for bulk, MiniLM-L6 local ($0) for embeddings
12. Self-healing: Exception handling, stale cleanup, HNSW rebuild
13. Pricing: Free → Pro → Team → Enterprise
14. V2 Injection: Unified pattern+doc ranking, hierarchical Thompson sampling, graded reward, SNIPS feedback
15. Roadmap: Usage dashboard, tier system, pattern marketplace

## Data Sources
- docs/quoth-docs/quoth-business-en.md
- docs/quoth-docs/quoth-technical-en.md
- docs/project/01-system-overview.md
- docs/project/02-plugin-architecture.md
- CLAUDE.md (project instructions)
