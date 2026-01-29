# Decisions

Architecture and design decisions for this project.

## [2026-01-29] Jina Embeddings v3 (512d) over OpenAI

**Context:** Needed embedding model for RAG pipeline. OpenAI ada-002 uses 1536d, Jina v3 supports 512d.

**Decision:** Use Jina Embeddings v3 at 512 dimensions with IVFFlat indexing.

**Consequences:** 3x smaller vectors, faster similarity search, lower storage costs. Trade-off: slightly less semantic precision at 512d vs 1536d, mitigated by Cohere reranking.

## [2026-01-29] Dual Auth: Supabase OAuth + Custom JWT API Keys

**Context:** MCP clients need token-based auth, web dashboard needs session auth. Single system couldn't serve both.

**Decision:** Supabase Auth for web sessions (cookie-based), custom HS256 JWT for MCP API keys (header-based). Both verified in `createAuthenticatedMcpHandler()`.

**Consequences:** Two auth paths to maintain. API keys stored as SHA256 hashes. 90-day expiration. Dashboard uses `@supabase/ssr` cookie management.

## [2026-01-29] No GitHub Integration

**Context:** Earlier versions used GitHub as document storage. Created webhook complexity and sync issues.

**Decision:** Supabase is the single source of truth. No GitHub integration.

**Consequences:** Simpler architecture. Documents stored in `documents` table with automatic versioning via DB triggers. No webhook handlers needed.

## [2026-01-29] AST-Aware Chunking with Header Fallback

**Context:** Code documentation needs intelligent chunking for quality embeddings. Simple text splitting loses semantic boundaries.

**Decision:** Tree-sitter AST parsing for code files, H2 header-based splitting for markdown. Silent fallback if WASM unavailable.

**Consequences:** Better chunk quality when AST works. Risk of inconsistent chunking across environments if WASM files missing. Fallback produces valid but coarser chunks.
