# Quoth Supabase Vector Implementation Report

**Date:** 2026-01-11
**Status:** Complete
**Production URL:** https://quoth.ai-innovation.site

---

## Executive Summary

Transformed Quoth from a file-based document reader to a **semantic search engine** using:
- **Supabase** with pgvector for vector storage
- **Google Gemini** (text-embedding-004) for 768-dimension embeddings
- **Multi-tenant architecture** ready for multiple projects

The search now understands **meaning and context** rather than just matching keywords.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Client                               │
│                    (Claude, AI Agents)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Quoth MCP Server                             │
│                   /api/mcp (Next.js)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ search_index│  │  read_doc   │  │    propose_update       │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
└─────────┼────────────────┼──────────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Vector Search Layer                           │
│  ┌─────────────────┐       ┌──────────────────────────────────┐ │
│  │  Gemini API     │       │         Supabase                 │ │
│  │  text-embedding │──────▶│  ┌─────────┐  ┌────────────────┐ │ │
│  │  -004 (768d)    │       │  │projects │  │document_       │ │ │
│  └─────────────────┘       │  └─────────┘  │embeddings      │ │ │
│                            │  ┌─────────┐  │(768 vectors)   │ │ │
│                            │  │documents│  └────────────────┘ │ │
│                            │  └─────────┘                     │ │
│                            └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/supabase.ts` | 85 | Supabase client, types, project management |
| `src/lib/ai.ts` | 58 | Gemini embedding generation with rate limiting |
| `src/lib/sync.ts` | 142 | Document sync, chunking, and indexing logic |
| `scripts/index-knowledge-base.ts` | 156 | Initial indexing script for knowledge base |
| `supabase/migrations/001_vector_schema.sql` | 79 | Database schema with pgvector |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/quoth/search.ts` | Complete rewrite for Supabase vector search |
| `src/lib/quoth/tools.ts` | Updated to use semantic search, improved output format |
| `package.json` | Added @supabase/supabase-js, @google/generative-ai, dotenv, tsx |
| `.gitignore` | Added supabase/.temp/ |
| `CLAUDE.md` | Documented vector architecture |

---

## Database Schema

### Tables

#### `projects`
```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,        -- e.g., "quoth-knowledge-base"
  github_repo text NOT NULL,        -- e.g., "org/repo"
  created_at timestamp with time zone DEFAULT now()
);
```

#### `documents`
```sql
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,          -- e.g., "patterns/backend-unit.md"
  title text NOT NULL,
  content text NOT NULL,            -- Full markdown content
  checksum text NOT NULL,           -- MD5 hash for change detection
  last_updated timestamp with time zone DEFAULT now(),
  UNIQUE(project_id, file_path)
);
```

#### `document_embeddings`
```sql
CREATE TABLE document_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  content_chunk text NOT NULL,      -- Text fragment that was embedded
  embedding vector(768),            -- Gemini text-embedding-004 output
  metadata jsonb                    -- { "chunk_index": 0, "source": "markdown-h2-split" }
);
```

### RPC Functions

#### `match_documents`
Semantic similarity search using cosine distance:
```sql
CREATE FUNCTION match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_project_id uuid
) RETURNS TABLE (
  id uuid,
  document_id uuid,
  content_chunk text,
  similarity float,
  file_path text,
  title text
)
```

#### `get_document_by_path`
Direct document lookup by file path.

---

## Core Services

### 1. Supabase Client (`src/lib/supabase.ts`)

```typescript
// Key exports
export const supabase: SupabaseClient
export function isSupabaseConfigured(): boolean
export async function getOrCreateProject(slug, githubRepo): Promise<Project>
export async function getProjectBySlug(slug): Promise<Project | null>
```

### 2. Gemini Embedding Service (`src/lib/ai.ts`)

```typescript
// Key exports
export async function generateEmbedding(text: string): Promise<number[]>
export function isAIConfigured(): boolean
export async function generateEmbeddingsBatch(texts, delayMs): Promise<number[][]>
```

**Configuration:**
- Model: `text-embedding-004`
- Output: 768-dimension float vector
- Rate limit: 15 RPM (4.2s delay between requests)

### 3. Sync Service (`src/lib/sync.ts`)

```typescript
// Key exports
export function calculateChecksum(content: string): string
export function chunkByHeaders(content: string, minChunkLength?: number): string[]
export async function syncDocument(projectId, filePath, title, content): Promise<{document, chunksIndexed}>
export async function deleteDocument(projectId, filePath): Promise<boolean>
export async function getSyncStatus(projectId): Promise<{documentCount, embeddingCount, lastSync}>
```

**Chunking Strategy:**
- Split content by H2 headers (`## `)
- Minimum chunk length: 50 characters
- If no H2 headers, treat entire content as one chunk

---

## MCP Tools

### `quoth_search_index` (Updated)

**Before:** Simple text matching on id/title/type
**After:** Semantic vector similarity search

```typescript
// Input
{ query: "how to mock dependencies in tests" }

// Output
{
  "results": [
    {
      "title": "pattern-backend-unit",
      "path": "patterns/backend-unit-vitest.md",
      "type": "testing-pattern",
      "relevance": 0.72,  // 72% similarity
      "snippet": "Code Example (Canonical)..."
    }
  ]
}
```

### `quoth_read_doc` (Updated)

**Before:** File system read
**After:** Supabase query with fuzzy matching

Supports lookup by:
- Document title (e.g., `pattern-backend-unit`)
- File path (e.g., `patterns/backend-unit-vitest.md`)
- Partial match (e.g., `backend-unit`)

### `quoth_propose_update` (Unchanged)

Still logs proposals for human review. Future enhancement: Store in Supabase.

---

## Indexing Script

### Usage

```bash
npx tsx scripts/index-knowledge-base.ts
```

### Process

1. Load environment from `.env.local`
2. Create/get project in Supabase
3. Scan `quoth-knowledge-base/` for markdown files
4. For each file:
   - Calculate MD5 checksum
   - Skip if unchanged (checksum match)
   - Parse frontmatter with gray-matter
   - Upsert document record
   - Delete old embeddings
   - Chunk by H2 headers
   - Generate Gemini embeddings (with 4s delay)
   - Insert new embeddings

### Output Example

```
🦅 Quoth Knowledge Base Indexer

📁 Project: quoth-knowledge-base
   Created new project: b6fc48df-f192-49ea-b9b6-f86d53c69c47

📄 Found 10 markdown files

[1/10] architecture/backend-repo-structure.md
   📊 4 chunks to embed
   ✅ Indexed 4 chunks
...

==================================================
📊 Indexing Complete
   Files processed: 10
   Files skipped (unchanged): 0
   Total chunks indexed: 46
==================================================
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (write access) | Yes |
| `GEMINIAI_API_KEY` | Google AI Studio API key | Yes |
| `GOOGLE_API_KEY` | Fallback for Gemini API | No |
| `QUOTH_PROJECT_SLUG` | Default project slug | No (default: `quoth-knowledge-base`) |

---

## Search Configuration

```typescript
const SEARCH_CONFIG = {
  matchThreshold: 0.65,  // Minimum similarity score (0-1)
  matchCount: 10,        // Maximum results to return
};
```

---

## Performance Characteristics

### Indexing Performance
- ~4 seconds per chunk (Gemini rate limit)
- 46 chunks indexed in ~3 minutes
- Incremental: unchanged files are skipped

### Search Performance
- Query embedding: ~200ms
- Supabase RPC: ~50ms
- Total: ~250ms per search

### Storage
- 768 floats per embedding × 4 bytes = ~3KB per chunk
- 46 chunks × 3KB = ~138KB for current knowledge base
- Supabase free tier: 500MB (sufficient for ~100,000 chunks)

---

## Testing Results

### Local Testing

```bash
# Tools list
curl -X POST http://localhost:3000/api/mcp \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# ✅ Returns 3 tools

# Semantic search
curl -X POST http://localhost:3000/api/mcp \
  -d '{"method":"tools/call","params":{"name":"quoth_search_index","arguments":{"query":"how to mock dependencies"}}}'
# ✅ Returns pattern-backend-unit (72% match)

# Read document
curl -X POST http://localhost:3000/api/mcp \
  -d '{"method":"tools/call","params":{"name":"quoth_read_doc","arguments":{"doc_id":"pattern-backend-unit"}}}'
# ✅ Returns full document content
```

### Production Testing

```bash
curl -X POST https://quoth.ai-innovation.site/api/mcp \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"quoth_search_index","arguments":{"query":"playwright e2e testing"}}}'
# ✅ Returns pattern-frontend-e2e (67% match)
```

---

## Commits

1. **50dfb48** - `feat: Implement Supabase vector search with Gemini embeddings`
   - Core implementation of all services
   - SQL schema and migrations
   - Updated MCP tools

2. **d9a2aa1** - `docs: Update CLAUDE.md with Supabase vector architecture`
   - Documentation updates

---

## Future Enhancements

1. **GitHub Webhook Integration**
   - Auto-reindex on push to main
   - Webhook endpoint at `/api/webhooks/github`

2. **Proposal Storage in Supabase**
   - Store `quoth_propose_update` proposals in database
   - Add approval workflow

3. **Multi-Project Dashboard**
   - Web UI to manage multiple projects
   - View indexed documents and search history

4. **Improved Chunking**
   - Consider code block boundaries
   - Semantic chunking based on content

5. **Caching Layer**
   - Cache frequent queries
   - Reduce Gemini API calls

---

## Troubleshooting

### "Supabase not configured"
Ensure environment variables are set:
```bash
vercel env pull .env.local --environment=production
```

### "Project not found"
Run the indexing script:
```bash
npx tsx scripts/index-knowledge-base.ts
```

### "Gemini API rate limit"
The script includes 4s delays. For large batches, increase delay:
```typescript
// In ai.ts
delayMs: 5000 // 12 requests per minute
```

### Empty search results
Lower the match threshold:
```typescript
// In search.ts
matchThreshold: 0.5 // More permissive
```

---

## Dependencies Added

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.24.0",
    "@supabase/supabase-js": "^2.49.4"
  },
  "devDependencies": {
    "dotenv": "^17.2.3",
    "tsx": "^4.20.3"
  }
}
```

---

## Conclusion

Quoth now provides **intelligent semantic search** that understands developer intent. The query "how to mock dependencies in vitest tests" correctly returns the Vitest mocking patterns document with 72% similarity, compared to the previous keyword-based approach that would have required exact term matches.

The architecture is:
- **Scalable**: Supabase handles vector operations efficiently
- **Cost-effective**: Free tiers for both Supabase and Gemini
- **Multi-tenant ready**: Projects table supports multiple knowledge bases
- **Incremental**: Only changed documents are re-indexed
