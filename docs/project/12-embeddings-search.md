# Embeddings & Search

This document covers the embedding generation and search infrastructure across both the local plugin (SQLite + HNSW) and the cloud SaaS (Neon pgvector + full-text search).

## Embedding Model

| Property | Value |
|----------|-------|
| **Model** | `voyage/voyage-4-lite` (Voyage AI) |
| **Dimensions** | 1024 |
| **Cost** | $0.02/MTok (6.5x cheaper than text-embedding-3-large at $0.13/MTok) |
| **Gateway** | Vercel AI Gateway at `ai-gateway.vercel.sh/v1` |
| **Protocol** | OpenAI-compatible embeddings API |

The same model is used by both the local daemon and the cloud SaaS, ensuring embedding compatibility across the entire system.

## Local Embeddings (Plugin)

### Embedding Generation (`daemon/lib/embed.js`)

The local daemon generates embeddings using raw HTTPS requests to the Vercel AI Gateway, with no SDK dependency.

**Configuration:**
- Host: `ai-gateway.vercel.sh`
- Path: `/v1/embeddings`
- Auth: `AI_GATEWAY_API_KEY` environment variable (Vercel `vck_*` key)
- Timeout: 10,000ms

**Behavior:**
- Text cleaning: replaces all newlines with spaces, trims whitespace
- Returns `null` on any failure (missing API key, empty text, network error, timeout, invalid JSON)
- Called during the daemon's DISTILL pipeline stage to embed newly distilled patterns

```javascript
// Usage
const { generateEmbedding } = require('./lib/embed.js')
const vector = await generateEmbedding("pattern condition text")
// Returns: number[1024] | null
```

### HNSW Index (`daemon/lib/hnsw.js`)

Pure JavaScript implementation of the Hierarchical Navigable Small World graph algorithm for approximate nearest neighbor search.

**Constructor Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dimensions` | 1536 | Vector dimensionality (constructor default; works with any dimension) |
| `M` | 16 | Max neighbors per layer (layer > 0) |
| `M0` | 32 (2 * M) | Max neighbors at layer 0 |
| `efConstruction` | 200 | Construction beam width |
| `mL` | `1 / Math.log(M)` | Level generation probability factor |

**Node Storage:**
Each node is stored in a `Map<id, { vector, layers: Set[], deleted }>`. Layers is an array of Sets, where each Set contains neighbor IDs at that layer level.

**Operations:**

**`add(id, vector)`** -- Insert a new vector into the index:
1. Assign a random layer using the HNSW probability distribution: `floor(-ln(random) * mL)`
2. If this is the first node, set as entry point and return
3. Phase 1: Greedy descent from the top layer down to `nodeLayer + 1`, finding the closest node at each layer
4. Phase 2: At each layer from `min(nodeLayer, maxLayer)` down to 0, run ef-bounded search to find neighbors, add bidirectional edges, and prune any neighbor that exceeds `maxM` connections
5. If the new node's layer exceeds `maxLayer`, update the entry point

**`remove(id)`** -- Soft delete: marks the node as `deleted = true`. The node remains in the graph structure but is excluded from search results. Edges are not modified.

**`search(queryVector, k, efSearch=50)`** -- k-NN search:
1. If the index is empty or the query vector has wrong dimensions, return `[]`
2. Set `ef = max(efSearch, k)` to ensure at least k candidates
3. Greedy descent from entry point through layers `maxLayer` down to layer 1
4. ef-bounded search at layer 0 with the greedy descent result as entry
5. Filter out deleted nodes, sort by distance ascending, return top k results as `[{ id, distance }]`

**`buildFromDb(db)`** -- Bulk load from SQLite:
1. Reset all internal state (nodes, entry point, maxLayer)
2. Query all active patterns with non-null embeddings
3. Parse each embedding from JSON string and call `add()` for each vector matching the expected dimensions
4. Silently skip malformed embeddings

**`save(filePath)` / `load(filePath)`** -- JSON serialization:
- Save: Writes `{ dimensions, M, entryPoint, maxLayer, nodes }` to disk. Skips deleted nodes. Each node stores its vector and layers (Sets serialized as arrays). Path: `~/.quoth/hnsw.index.json`
- Load: Reads and deserializes, reconstructing Sets from arrays. Restores index parameters.

**Distance Function:**
Uses cosine distance (`1 - cosineSimilarity`) for all internal distance calculations.

**Search Algorithm Detail:**

The ef-bounded search at layer 0 (`_searchLayerEf`) maintains two priority queues:
- **candidates** (sorted closest-first): nodes to expand
- **results** (sorted farthest-first): current best results

The algorithm expands the closest candidate, examining its neighbors. A neighbor is added to both queues if it is closer than the farthest result or if results has fewer than `ef` entries. Results are pruned to `ef` entries after each insertion. Expansion stops when the closest remaining candidate is farther than the farthest result.

**Complexity:** O(log n) search vs O(n) linear scan.

### Linear Scan Fallback

When HNSW fails or returns empty results, `db.searchBySimilarity()` falls back to a linear scan:

1. Load all active patterns with non-null embeddings from SQLite
2. Compute exact cosine similarity between the query vector and each pattern's embedding
3. Sort by similarity descending
4. Return top k results

If no patterns have embeddings at all, the function further falls back to `getTopPatterns()` which returns the highest-confidence patterns regardless of embedding similarity.

### Cosine Similarity (Local)

Implemented identically in both `db.js` and `hnsw.js`:

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}
```

Both implementations guard against division by zero (returns 0 if either vector has zero magnitude).

## Cloud Embeddings (SaaS)

### Embedding Generation (`src/lib/embeddings/gateway.ts`)

The cloud SaaS generates embeddings using the AI SDK (`embed()` / `embedMany()`) with the Vercel AI Gateway as an OpenAI-compatible provider.

**Configuration:**
- Provider: `@ai-sdk/openai` with `createOpenAI()` pointing to `https://ai-gateway.vercel.sh/v1`
- Auth: `AI_GATEWAY_API_KEY` (preferred) or `OPENAI_API_KEY` (fallback)
- Model: `voyage/voyage-4-lite`
- Dimensions: 1024
- Batch size: 2048 inputs per `embedMany()` call (OpenAI API limit)

**Functions:**

**`generateEmbedding(text)`** -- Single text embedding:
- Cleans text: replaces newlines with spaces, trims
- Throws on empty/whitespace-only input (unlike local daemon which returns null)
- Returns `number[1024]`

**`generateEmbeddingsBatch(texts)`** -- Batch embedding:
- Filters out empty/whitespace-only texts (tracked by index)
- If all texts are empty, returns zero vectors without making an API call
- Processes non-empty texts in batches of 2048
- Maps results back to original indices; empty texts get zero vectors
- Returns `number[1024][]` in same order as input

**`isGatewayConfigured()`** -- Returns true if `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` is set.

### Vector Search (Neon pgvector)

The cloud database uses pgvector HNSW indexes for approximate nearest neighbor search:

**Index on `docs.chunks.embedding`:**
- Type: HNSW
- Operator class: `vector_cosine_ops`
- Parameters: m=16, ef_construction=200
- Filter: `WHERE embedding_model = 'voyage/voyage-4-lite'`
- Used by: `docs.match_chunks()` SQL function

**Index on `agents.memory.embedding`:**
- Type: HNSW
- Operator class: `vector_cosine_ops`
- Parameters: m=16, ef_construction=200
- Filter: `WHERE embedding IS NOT NULL`
- Used by: agent memory search queries

### Reranking (`src/lib/embeddings/reranker.ts`)

Two-provider reranking with automatic failover.

**Providers:**

| Provider | Model | Role | Auth |
|----------|-------|------|------|
| Cohere | `rerank-english-v3.0` | Primary | `COHERE_API_KEY` |
| Jina AI | `jina-reranker-v2-base-multilingual` | Fallback | `JINA_API_KEY` |

Both providers have a 10-second timeout. If Cohere fails (timeout, error, or not configured), the system falls back to Jina. If both fail, an error is thrown.

**Dynamic Cutoff Algorithm:**
After reranking, results are filtered using a two-phase cutoff:
1. Skip any result below `minScore` (default 0.5) -- absolute minimum
2. After collecting `minResults` (default 10) results, stop if the score drops below `highRelevanceThreshold` (default 0.65)

This ensures at least `minResults` quality results while cutting off the long tail of low-relevance matches.

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `topN` | 30 | Maximum results to request from the reranker |
| `minScore` | 0.5 | Absolute minimum relevance score |
| `minResults` | 10 | Minimum results to keep before applying high threshold |
| `highRelevanceThreshold` | 0.65 | Score cutoff after minResults are collected |

**`isRerankerConfigured()`** -- Returns true if either `COHERE_API_KEY` or `JINA_API_KEY` is set.

## Search Pipeline (Cloud)

### Architecture (`src/lib/search/pipeline.ts`)

The cloud search pipeline implements hybrid vector + full-text search with Reciprocal Rank Fusion (RRF), optional reranking, and persistent caching.

### Pipeline Flow

```
Query
  |
  v
[1] Check persistent cache (search.query_cache)
  |-- HIT --> return cached results (chunk IDs + scores)
  |-- MISS --v
[2] Generate query embedding (voyage/voyage-4-lite)
  |
  v
[3] Parallel execution:
  |-- Vector search: docs.match_chunks(embedding, threshold, limit, project_id, model)
  |-- FTS search:    docs.keyword_search(query, project_id, limit)
  |
  v
[4] Reciprocal Rank Fusion (merge vector + FTS results)
  |
  v
[5] Optional reranking (pro/team/enterprise tiers only)
  |-- Cohere primary, Jina fallback
  |-- On reranker failure: use RRF scores
  |
  v
[6] Cache results (fire-and-forget, 1-hour TTL)
  |
  v
[7] Optional: merge shared docs (scope = 'shared' | 'all')
  |
  v
[8] Fire-and-forget: trigger consolidation if overdue
  |
  v
Return SearchResult[]
```

### Reciprocal Rank Fusion (RRF)

Merges vector and full-text search results using the formula:

```
score(d) = sum( weight_i / (k + rank_i) ) for each result list i
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `k` (RRF_K) | 60 | Rank smoothing constant |
| `hybridWeight` | 0.6 | Vector weight (FTS weight = 1 - hybridWeight) |

The algorithm:
1. Score each vector result: `hybridWeight * (1 / (k + rank + 1))`
2. Score each FTS result: `(1 - hybridWeight) * (1 / (k + rank + 1))`
3. Sum scores for results appearing in both lists
4. Sort by total RRF score descending

### Search Configuration Constants

Defined in `src/lib/search/types.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `EMBEDDING_MODEL` | `'voyage/voyage-4-lite'` | Default embedding model |
| `RRF_K` | 60 | RRF rank smoothing constant |
| `DEFAULT_THRESHOLD` | 0.5 | Minimum vector similarity threshold |
| `DEFAULT_HYBRID_WEIGHT` | 0.6 | Vector vs FTS weight (slightly favors vector) |
| `HNSW_EF_SEARCH` | 100 | pgvector ef_search parameter for recall quality |
| `CACHE_TTL_MINUTES` | 60 | Query cache time-to-live |
| `RERANK_TIERS` | `['pro', 'team', 'enterprise']` | Tiers allowed to use reranking |

### Adaptive Fetch Count

The number of candidates fetched adapts to query complexity based on word count:

| Query Complexity | Word Count | Fetch Count |
|------------------|------------|-------------|
| Simple | 1-4 words | 10 |
| Medium | 5-12 words | 20 |
| Complex | 13+ words | 30 |

Can be overridden via `options.limit`.

### Search Options

```typescript
interface SearchOptions {
  limit?: number;           // Override adaptive fetch count
  threshold?: number;       // Minimum similarity (default 0.5)
  rerank?: boolean;         // Force reranking on/off (default: auto by tier)
  hybridWeight?: number;    // 0 = FTS only, 1 = vector only (default 0.6)
  scope?: 'project' | 'shared' | 'all';  // Include shared docs
}
```

### Search Result

```typescript
interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  filePath: string;
  title: string;
  similarity: number;       // Score: cosine similarity, RRF score, or rerank score
  source: 'vector' | 'fts' | 'reranked';
  metadata?: Record<string, unknown>;
  projectId?: string;       // Only for shared doc results
  agentId?: string;         // Only for shared doc results
  tags?: string[];           // Only for shared doc results
}
```

### Query Cache (`src/lib/search/cache.ts`)

Persistent caching layer backed by the `search.query_cache` table in Neon Postgres.

**Cache Key:** SHA-256 hash of normalized `{projectId}:{query}:{model}`. Whitespace in the query is collapsed to increase hit rate.

**Operations:**

**`getCachedResults(projectId, query, model)`** -- Check for a cache hit:
- Looks up by `(project_id, query_hash, embedding_model)` where `expires_at > now()`
- Returns `{ resultIds, resultScores, reranked }` or `null`
- On error: returns `null` (graceful degradation)

**`setCachedResults(projectId, query, model, chunkIds, scores, reranked, ttlMinutes)`** -- Store results:
- Uses `INSERT ... ON CONFLICT DO UPDATE` to upsert
- TTL defaults to 60 minutes
- Fire-and-forget (caller does not await)
- On error: logs warning and continues

**`invalidateProjectCache(projectId)`** -- Delete all cached results for a project:
- Called when documents are created, updated, or deleted
- Ensures stale results are not served after content changes

## Search Flow Comparison

### Local (Plugin) -- `quoth_search_patterns` MCP tool

1. User prompt triggers `quoth_search_patterns(query)` via MCP
2. Generate query embedding via `daemon/lib/embed.js` (raw HTTPS to Vercel AI Gateway)
3. Call `db.searchBySimilarity(queryVector, limit)`:
   a. Try HNSW index for `limit * 3` candidates
   b. Fetch candidate metadata from SQLite
   c. Re-score with exact cosine similarity
   d. On HNSW failure: linear scan over all embeddings
   e. On no embeddings: fall back to `getTopPatterns()` (confidence-based)
4. Update `last_matched_at` on matched patterns
5. Return scored pattern results

### Cloud (SaaS) -- `/api/v1/search`

1. API request arrives at search endpoint
2. Check `search.query_cache` for cached results
3. If cache miss: generate embedding via AI SDK + Vercel AI Gateway
4. Run vector search (pgvector HNSW) and full-text search (tsvector GIN) in parallel
5. Merge with Reciprocal Rank Fusion
6. Apply reranking for pro/team/enterprise tiers (Cohere primary, Jina fallback)
7. Cache results (1-hour TTL, fire-and-forget)
8. Log to `search.logs`
9. Track usage in `analytics.usage`
10. Optionally merge shared/public docs from other projects
11. Return `SearchResult[]`

## Environment Variables

| Variable | Required By | Description |
|----------|-------------|-------------|
| `AI_GATEWAY_API_KEY` | Both | Vercel AI Gateway key (`vck_*`) for embeddings |
| `OPENAI_API_KEY` | Cloud (fallback) | Fallback if AI_GATEWAY_API_KEY not set |
| `COHERE_API_KEY` | Cloud (optional) | Cohere reranking (primary) |
| `JINA_API_KEY` | Cloud (optional) | Jina reranking (fallback) |
