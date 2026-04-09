# Embeddings & Search

**Version:** 1.0.3 | **Last updated:** 2026-04-09

Quoth uses local embeddings for semantic pattern search, with a pure-JS HNSW index for approximate nearest-neighbor retrieval.

## Embedding Model

Local MiniLM-L6-v2 via `@xenova/transformers` (ONNX runtime). Zero API calls, ~5ms per embedding after warmup.

| Property | Value |
|----------|-------|
| Model | `Xenova/all-MiniLM-L6-v2` |
| Dimensions | 384 |
| Pooling | mean |
| Normalization | L2 (cosine-ready) |
| Quantized | Yes (faster inference) |

Previously used `voyage/voyage-4-lite` (1024d) via Vercel AI Gateway at $0.02/MTok. Replaced with local inference to eliminate API cost and latency.

## Embedding API (`daemon/lib/embed.js`)

```js
const { generateEmbedding, generateEmbeddingBatch, queueEmbedding, MODEL_NAME, DIMENSIONS } = require('./lib/embed.js')
```

### `generateEmbedding(text)`

Single embedding, immediate. Returns `number[]` (384d) or `null` on failure.

```js
const vec = await generateEmbedding('use grep with line numbers')
```

### `generateEmbeddingBatch(texts)`

Batch embedding in a single model pass. More efficient than calling `generateEmbedding` in a loop.

```js
const vecs = await generateEmbeddingBatch(['text one', 'text two'])
// Returns (number[]|null)[] — null entries for empty/failed inputs
```

### `queueEmbedding(text)`

Queues text for batched embedding. Flushes when `BATCH_THRESHOLD` (8) texts accumulate or `FLUSH_DELAY_MS` (2000ms) elapses. Used by the daemon pipeline for throughput.

```js
const vec = await queueEmbedding('pattern text here')
```

### Exports

| Export | Type | Value |
|--------|------|-------|
| `generateEmbedding` | function | Single embedding |
| `generateEmbeddingBatch` | function | Batch embedding (single pass) |
| `queueEmbedding` | function | Queued batching |
| `MODEL_NAME` | string | `'Xenova/all-MiniLM-L6-v2'` |
| `DIMENSIONS` | number | `384` |

## HNSW Index

Pure-JS HNSW index over the `patterns` table embeddings.

| Parameter | Value |
|-----------|-------|
| M | 16 |
| M0 | 32 |
| efConstruction | 200 |
| efSearch | 50 |
| Distance | Cosine |
| Complexity | O(log n) |

Persisted to disk every 30 minutes. Rebuilt on daemon start from SQLite embeddings.

## Search Pipeline

`quoth_search_patterns` MCP tool flow:

1. Embed query text via `generateEmbedding`
2. HNSW k-NN search (default k=10)
3. Filter by confidence threshold (default 0.1)
4. Return ranked results with similarity scores

```js
// MCP tool usage
await quoth_search_patterns({ query: 'retry logic timeout', limit: 5 })
```

## Pattern Storage

Embeddings stored as JSON arrays in the `patterns.embedding` column (SQLite). 384 floats per pattern. Loaded into HNSW index on startup.

```sql
-- Schema excerpt
embedding TEXT  -- JSON array, 384 floats
```

## Session Injection

At session start, top patterns with confidence ≥ 0.6 are retrieved via HNSW similarity to the current project context. Max 3 patterns injected to avoid noise.

At `UserPromptSubmit`, patterns with similarity ≥ 0.1 to the prompt are shown.
