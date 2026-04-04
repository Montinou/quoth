# Decisions

Architecture and design decisions for this project.

## [2026-01-29] No GitHub Integration

**Context:** Earlier versions used GitHub as document storage. Created webhook complexity and sync issues.

**Decision:** Database is the single source of truth. No GitHub integration.

**Consequences:** Simpler architecture. Documents stored in `documents` table with automatic versioning via DB triggers. No webhook handlers needed.

## [2026-01-29] AST-Aware Chunking with Header Fallback

**Context:** Code documentation needs intelligent chunking for quality embeddings. Simple text splitting loses semantic boundaries.

**Decision:** Tree-sitter AST parsing for code files, H2 header-based splitting for markdown. Silent fallback if WASM unavailable.

**Consequences:** Better chunk quality when AST works. Risk of inconsistent chunking across environments if WASM files missing. Fallback produces valid but coarser chunks.

## [2026-03-29] Clerk Auth (replacing Supabase Auth)

**Context:** Needed auth for both web dashboard and MCP API clients. Supabase Auth required complex JWT hooks and dual-path management.

**Decision:** Migrate to Clerk for all authentication. Web sessions via Clerk middleware, MCP API keys via custom HS256 JWT stored as SHA256 hashes.

**Consequences:** Single auth provider, simpler webhook handling (Clerk → user sync), built-in org management. API keys still use custom JWT for MCP compatibility.

## [2026-03-29] Neon PostgreSQL + Drizzle ORM (replacing Supabase)

**Context:** Supabase added operational complexity (auth + DB + storage coupled). Needed serverless-compatible PostgreSQL with clean migration story.

**Decision:** Neon serverless PostgreSQL with Drizzle ORM. Multi-schema design: public, agents, docs, search, analytics, comms.

**Consequences:** Clean schema separation, type-safe queries, serverless connection pooling. 6 migration files manage all DDL.

## [2026-04-02] text-embedding-3-large (2000d) via Vercel AI Gateway

**Context:** Previously used Jina Embeddings v3 at 512d, then text-embedding-3-small at 1536d. Needed better semantic precision.

**Decision:** Upgrade to OpenAI text-embedding-3-large with Matryoshka truncation at 2000 dimensions, accessed via Vercel AI Gateway. Migration 006 handles vector column resize and model tag updates.

**Consequences:** Higher embedding quality at cost of ~30% more storage. Vercel AI Gateway provides rate limiting and caching. Cohere reranking still used as second stage.

## [2026-04-03] Plugin v3.2.0 — Standalone Self-Learning

**Context:** Quoth plugin evolved from simple hook scripts to a full autonomous learning system with daemon, intelligence routing, and agent coordination.

**Decision:** Plugin (quoth-plugin/) operates independently with its own SQLite + HNSW storage. 22 MCP tools via stdio. Background daemon processes trajectories through JUDGE → DISTILL → CONSOLIDATE pipeline using Haiku subagents. Bayesian confidence scoring with Beta distribution.

**Consequences:** Zero-config learning that improves over time. Plugin and cloud platform share concepts but operate independently. High-confidence patterns (>0.8) auto-promote to cloud nightly.
