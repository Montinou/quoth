# Local Database (SQLite)

**Version:** 1.0.1 | **Last updated:** 2026-04-07

The Quoth plugin maintains a local SQLite database for pattern storage, trajectory tracking, agent coordination, and event sourcing. All data is stored on the user's machine at `~/.quoth/memory.db`.

## Database Location and Configuration

- **Path:** `~/.quoth/memory.db`
- **Engine:** better-sqlite3 (synchronous, embedded)
- **Journal Mode:** WAL (Write-Ahead Logging) for concurrent read performance
- **Synchronous:** NORMAL (balanced durability vs speed)
- **Foreign Keys:** ON (enforced referential integrity)
- **Source:** `quoth-plugin/daemon/db.js`

The database is created and migrated on first access via the `createDb(dbPath)` factory function. If the parent directory does not exist, it is created recursively.

## Tables

The schema defines 6 core tables plus 4 V2 auxiliary tables, all created via `CREATE TABLE IF NOT EXISTS` on every startup.

### patterns

Primary storage for learned and distilled patterns, scored using Bayesian confidence (Beta distribution).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | -- | SHA-1 hash (12 chars) derived from distilled content |
| `name` | TEXT NOT NULL | -- | Pattern name (max ~60 chars by convention) |
| `pattern_type` | TEXT NOT NULL | `'code-pattern'` | Type classification: `code-pattern`, `skill` |
| `condition` | TEXT NOT NULL | -- | When this pattern applies (trigger condition) |
| `action` | TEXT NOT NULL | -- | What to do when the pattern matches |
| `description` | TEXT | NULL | Optional extended description |
| `confidence` | REAL | 0.5 | Bayesian point estimate: `alpha / (alpha + beta)` |
| `success_count` | INTEGER | 0 | Total recorded successes |
| `failure_count` | INTEGER | 0 | Total recorded failures |
| `decay_rate` | REAL | 0.005 | Hourly decay rate applied to alpha |
| `embedding` | TEXT | NULL | JSON-serialized float array (384-dim MiniLM-L6-v2 local embeddings) |
| `version` | INTEGER | 1 | Schema version for forward compatibility |
| `tags` | TEXT | `'[]'` | JSON array of tag strings |
| `source` | TEXT | `'distilled'` | Origin: `distilled`, `exolar-seeded`, `healer-learned`, `attributed`, `skill-derived` |
| `status` | TEXT | `'active'` | Lifecycle state: `active`, `archived` |
| `created_at` | INTEGER | `strftime('%s','now') * 1000` | Creation timestamp (epoch ms) |
| `updated_at` | INTEGER | `strftime('%s','now') * 1000` | Last update timestamp (epoch ms) |
| `last_matched_at` | INTEGER | NULL | Last time pattern was matched or used |
| `alpha` | REAL | 1 | Beta distribution alpha parameter (success prior) |
| `beta` | REAL | 1 | Beta distribution beta parameter (failure prior) |
| `namespace` | TEXT | `'default'` | Project namespace or `'global'` for cross-project patterns |
| `promoted_at` | INTEGER | NULL | Epoch ms when promoted to Quoth cloud |
| `cloud_document_id` | TEXT | NULL | Cloud document ID after successful promotion |
| `promoted_confidence` | REAL | NULL | Confidence snapshot at time of promotion |
| `applicability` | TEXT | `'narrow'` | Scope classification: `narrow`, `broad` |
| `exposure_count` | INTEGER | 0 | Number of times injected into session context |
| `last_exposed_at` | INTEGER | NULL | Last time pattern was injected |
| `ignored_count` | INTEGER | 0 | Injection exposures with no observed benefit |
| `embedding_text` | TEXT | NULL | Source text used to generate the embedding |
| `pattern_trigrams` | TEXT | NULL | JSON-serialized trigram set for fast text similarity |
| `quality_history` | TEXT | `'[]'` | JSON array of historical quality scores |
| `cluster_id` | INTEGER | NULL | Cluster assignment (Thompson sampling groups) |
| `cluster_rank_score` | REAL | 0.5 | Cluster-level ranking score |
| `effective_exposures` | REAL | 0 | Weighted exposure count (discounted by outcomes) |
| `distinctiveness` | REAL | NULL | Embedding distinctiveness score within cluster |
| `retired_at` | INTEGER | NULL | Epoch ms when pattern was retired |
| `retired_reason` | TEXT | NULL | Reason for retirement |

**Indexes:**
- `idx_patterns_confidence` on `confidence DESC` -- fast top-N queries
- `idx_patterns_status` on `status` -- filter active/archived
- `idx_patterns_namespace` on `namespace` -- project scoping

### trajectories

Session-level trajectory tracking. Each trajectory represents one agent session and may link to an extracted pattern.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | -- | Generated as `{session}-{timestamp}-{random}` |
| `session_id` | TEXT | -- | Session identifier |
| `status` | TEXT | `'active'` | Trajectory state |
| `verdict` | TEXT | NULL | Judge verdict after processing |
| `task` | TEXT | NULL | Task description |
| `context` | TEXT | NULL | JSON-serialized context object |
| `total_steps` | INTEGER | 0 | Step count |
| `total_reward` | REAL | 0 | Cumulative reward |
| `started_at` | INTEGER | `strftime('%s','now') * 1000` | Start timestamp (epoch ms) |
| `ended_at` | INTEGER | NULL | End timestamp (epoch ms) |
| `extracted_pattern_id` | TEXT FK | NULL | References `patterns(id)` if a pattern was distilled |

### trajectory_steps

Individual tool calls and observations within a trajectory.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | AUTOINCREMENT | Sequential step ID |
| `trajectory_id` | TEXT FK NOT NULL | -- | References `trajectories(id)` |
| `step_number` | INTEGER NOT NULL | -- | Computed as `COUNT(*) + 1` for the trajectory |
| `action` | TEXT NOT NULL | -- | Tool/action name (e.g., `agent_stop`, `Write`, `Bash`) |
| `observation` | TEXT | NULL | Tool output or outcome |
| `reward` | REAL | 0 | Step-level reward signal |
| `metadata` | TEXT | NULL | JSON object; includes `processed: true` after daemon ingestion |
| `created_at` | INTEGER | `strftime('%s','now') * 1000` | Step timestamp (epoch ms) |

### memory_entries

General-purpose key-value memory with namespace scoping.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | -- | Unique identifier |
| `key` | TEXT NOT NULL | -- | Lookup key |
| `namespace` | TEXT | `'default'` | Isolation namespace |
| `content` | TEXT NOT NULL | -- | Stored value |
| `type` | TEXT | `'semantic'` | Entry type classification |
| `tags` | TEXT | NULL | JSON tags |
| `metadata` | TEXT | NULL | JSON metadata |
| `access_count` | INTEGER | 0 | Read counter |
| `status` | TEXT | `'active'` | Entry state |
| `created_at` | INTEGER | epoch ms | Creation timestamp |
| `updated_at` | INTEGER | epoch ms | Last update timestamp |
| `last_accessed_at` | INTEGER | NULL | Last read timestamp |

**Constraints:** `UNIQUE(namespace, key)`

### agent_registry

Local registry for agent coordination across sessions and projects.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `agent_id` | TEXT PK | -- | Unique agent identifier |
| `name` | TEXT NOT NULL | -- | Human-readable name |
| `type` | TEXT NOT NULL | -- | Agent type (e.g., `learner`, `curator`) |
| `project` | TEXT | NULL | Associated project |
| `platform` | TEXT | NULL | Platform identifier |
| `status` | TEXT | `'online'` | Agent status: `online`, `offline` |
| `capabilities` | TEXT | `'[]'` | JSON array of capability strings |
| `last_heartbeat` | INTEGER | NULL | Last heartbeat timestamp (epoch ms) |
| `registered_at` | INTEGER | epoch ms | Registration timestamp |
| `metadata` | TEXT | `'{}'` | JSON metadata |

### events

Append-only event sourcing log for all system activity.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | AUTOINCREMENT | Sequential event ID |
| `event_type` | TEXT NOT NULL | -- | Event classification string |
| `agent_id` | TEXT | NULL | Originating agent |
| `project` | TEXT | NULL | Associated project |
| `payload` | TEXT NOT NULL | -- | JSON event payload |
| `created_at` | INTEGER | epoch ms | Event timestamp |

**Indexes:**
- `idx_events_type` on `event_type` -- filter by event class
- `idx_events_agent` on `agent_id` -- filter by agent
- `idx_events_created` on `created_at DESC` -- reverse chronological queries

### cluster_stats

Hierarchical Thompson sampling: cluster-level Beta distribution for grouping patterns into injection cohorts. Compound primary key `(cluster_id, namespace)` so cluster IDs are scoped per namespace.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `cluster_id` | INTEGER NOT NULL | -- | Cluster identifier (0..K-1, local per namespace) |
| `namespace` | TEXT NOT NULL | `'default'` | Namespace scope |
| `alpha` | REAL | 1.0 | Beta distribution alpha (cluster success prior) |
| `beta` | REAL | 1.0 | Beta distribution beta (cluster failure prior) |
| `attempts` | INTEGER | 0 | Total injection attempts from this cluster |
| `centroid_embedding` | TEXT | NULL | JSON-serialized cluster centroid vector |
| `member_count` | INTEGER | 0 | Number of patterns assigned to this cluster |
| `updated_at` | INTEGER | epoch ms | Last update timestamp |

**Indexes:** `idx_cluster_stats_ns` on `namespace`

### injection_log

Tracks every pattern injection into agent sessions for outcome attribution and propensity scoring.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | AUTOINCREMENT | Sequential log ID |
| `session_id` | TEXT NOT NULL | -- | Claude Code session identifier |
| `namespace` | TEXT NOT NULL | -- | Pattern namespace |
| `pattern_id` | TEXT NOT NULL | -- | Injected pattern ID |
| `cluster_id` | INTEGER | NULL | Pattern's cluster assignment at injection time |
| `rank` | INTEGER NOT NULL | -- | Injection rank (1 = highest priority) |
| `propensity` | REAL NOT NULL | -- | Selection probability score |
| `is_exploration` | INTEGER | 0 | 1 if selected via Thompson exploration, 0 if exploitation |
| `query_text` | TEXT | NULL | Query that triggered the injection |
| `injected_at` | INTEGER NOT NULL | -- | Injection timestamp (epoch ms) |
| `outcome_at` | INTEGER | NULL | Outcome observation timestamp (epoch ms) |
| `reward` | REAL | NULL | Observed outcome reward signal |

**Indexes:** `idx_injection_log_session` on `session_id`, `idx_injection_log_pattern` on `pattern_id`, `idx_injection_log_pending` on `outcome_at WHERE outcome_at IS NULL`

### judge_queue

Pairwise comparison queue for LLM-based pattern ranking (A/B judgement).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | AUTOINCREMENT | Sequential queue ID |
| `session_id` | TEXT NOT NULL | -- | Session that generated the comparison |
| `pattern_a_id` | TEXT NOT NULL | -- | First pattern for comparison |
| `pattern_b_id` | TEXT NOT NULL | -- | Second pattern for comparison |
| `trajectory_summary` | TEXT | NULL | Summary of the trajectory context |
| `priority` | REAL | 0.5 | Queue priority (higher = processed first) |
| `status` | TEXT | `'pending'` | Queue state: `pending`, `judged` |
| `verdict` | TEXT | NULL | LLM judge verdict |
| `judged_at` | INTEGER | NULL | Judgement timestamp (epoch ms) |
| `cost_cents` | REAL | NULL | LLM cost for this judgement |
| `created_at` | INTEGER | epoch ms | Creation timestamp |

**Indexes:** `idx_judge_queue_status` on `(status, priority DESC)`

### doc_chunks

Chunked project documentation with embeddings for semantic search during session context injection.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | -- | Chunk identifier |
| `doc_file` | TEXT NOT NULL | -- | Source documentation file path |
| `section_header` | TEXT NOT NULL | -- | Section heading the chunk belongs to |
| `content` | TEXT NOT NULL | -- | Chunk text content |
| `embedding` | TEXT | NULL | JSON-serialized 384-dim embedding |
| `content_hash` | TEXT | NULL | Hash of content for change detection |
| `updated_at` | INTEGER | epoch ms | Last update timestamp |

**Indexes:** `idx_doc_chunks_file` on `doc_file`

## Key Methods

The `createDb()` factory attaches all data access methods directly to the better-sqlite3 database instance.

### Pattern Operations

**`findDuplicateByName(name, threshold)`** -- Scan active patterns for a name-prefix match. Normalizes both names (lowercase, strip non-alphanumeric, trim), then checks if they share >= `threshold` (default 0.8) of characters as a common prefix. Returns the first match (highest confidence) or `null`. Scans top 200 patterns by confidence.

**`findDuplicateByEmbedding(embedding, threshold)`** -- Search HNSW index for a vector with cosine similarity >= `threshold` (default 0.92). Returns the matching pattern row with `_similarity` score, or `null`. Requires HNSW to be healthy and non-empty.

**`upsertPattern(p)`** -- Insert a new pattern or update an existing one. Uses `INSERT ... ON CONFLICT(id) DO UPDATE`. If the pattern includes an embedding and HNSW is healthy, the vector is also added to the in-memory HNSW index. Embedding on conflict uses `COALESCE(excluded.embedding, patterns.embedding)` to preserve existing embeddings when not explicitly overwritten.

**`getPattern(id)`** -- Single pattern lookup by ID. Returns the row with `tags` parsed from JSON string to array, or `null` if not found.

**`getTopPatterns(limit, tags)`** -- Retrieve the top N active patterns ordered by `confidence DESC`. Optional `tags` array filters via `LIKE '%"tag"%'` on the JSON tags field.

**`searchBySimilarity(queryVector, limit, tags)`** -- Two-phase semantic search:
1. **HNSW phase:** If HNSW is healthy and populated, search for `limit * 3` candidates via approximate nearest neighbor. Fetch their metadata from SQLite. Re-score with exact cosine similarity for final ranking. Return top `limit` if any results found.
2. **Linear scan fallback:** If HNSW fails or returns empty, load all active patterns with embeddings from SQLite, compute cosine similarity against each, sort descending, return top `limit`. If no patterns have embeddings at all, falls back to `getTopPatterns()`.

**`getProjectPatterns(namespace, limit)`** -- Patterns for a specific project namespace plus all global patterns, ordered by confidence. Uses `WHERE namespace = ? OR namespace = 'global'`.

**`setPatternNamespace(id, namespace)`** -- Set a pattern's project scope.

**`promoteToGlobal(id)`** -- Move a pattern to the `'global'` namespace so it appears across all projects.

### Bayesian Confidence Operations

**`applyConfidenceDelta(id, delta)`** -- Legacy direct confidence adjustment. Clamps confidence to `[0.0, 1.0]`. Increments `success_count` if delta > 0, `failure_count` if delta < 0. Updates `last_matched_at`.

**`applyBayesianUpdate(id, outcome)`** -- Proper Bayesian update via Beta distribution:
- **Success:** `alpha += 1`, `confidence = (alpha + 1) / (alpha + 1 + beta)`
- **Failure:** `beta += 1`, `confidence = alpha / (alpha + beta + 1)`
- Both paths update `last_matched_at` and the corresponding count.

**`applyHourlyDecay()`** -- Called by the daemon on a schedule. Exposure-based decay only — never-exposed patterns are not penalized (no signal = no change). Two tiers:
1. **Tier 1 — Exposed but unhelpful:** Patterns with `exposure_count >= 5` and a conversion rate below 10% get `beta += 0.05` per hour.
2. **Tier 2 — Dominance prevention:** Patterns with `exposure_count > 20` get very gentle alpha decay: `alpha *= 0.9995` per hour (~3.5% weekly reduction), floored at 0.1.

**`archiveWeakPatterns()`** -- Three rules:
1. Set `status = 'archived'` for patterns where `confidence < 0.1` AND `exposure_count >= 10` AND conversion rate (success / exposure) < 5% (evidence-based archival with enough data).
2. Archive raw tool-call patterns (`name LIKE 'claude-code: Bash %'` etc.) with `confidence < 0.15` and zero feedback (garbage cleanup).
3. Archive patterns older than 30 days with `exposure_count = 0` and no feedback (never-exposed stale patterns; threshold was previously 90 days).

**`pruneYoungUnused()`** -- Delete patterns aged 1–24 hours with zero exposures, zero successes, and zero failures (distiller noise cleanup). Returns the number of deleted rows.

**`getPromotionCandidates()`** -- Find patterns eligible for cloud promotion: `confidence > 0.8`, `(success_count + failure_count) > 10`, `status = 'active'`, `source = 'distilled'`.

**`markPromoted(id, cloudDocumentId, confidence)`** -- Record promotion metadata: sets `promoted_at`, `cloud_document_id`, and `promoted_confidence` snapshot.

### Doc Chunk Operations

**`upsertDocChunk(chunk)`** -- Insert or update a documentation chunk via `INSERT ... ON CONFLICT(id) DO UPDATE`. Updates `content`, `embedding`, `content_hash`, and `updated_at` on conflict.

**`searchDocChunks(queryVector, limit)`** -- Linear scan over all `doc_chunks` rows with embeddings. Computes cosine similarity against each, sorts descending, returns top `limit` (default 3). No HNSW path — doc chunks use linear scan only.

**`getDocChunkCount()`** -- Returns the total count of rows in `doc_chunks`.

### Trajectory Operations

**`appendTrajectoryEntry(entry)`** -- Creates a trajectory record (if not exists via `INSERT OR IGNORE`) and appends a step. The step number is computed as `COUNT(*) + 1` for the trajectory. The `action` field defaults to `'agent_stop'` if `entry.event` is not set.

**`getPendingTrajectoryEntries(limit)`** -- Retrieve up to `limit` (default 50) unprocessed steps by checking that `metadata NOT LIKE '%"processed":true%'`. Joins with `trajectories` to include `session_id`.

**`markStepProcessed(stepId)`** -- Parses the step's JSON metadata, sets `processed: true`, and writes it back.

### Agent Operations

**`registerAgent(agent)`** -- Upsert an agent via `INSERT ... ON CONFLICT(agent_id) DO UPDATE`. Sets `last_heartbeat` to `Date.now()`. Serializes `capabilities` and `metadata` as JSON.

**`heartbeat(agentId, status)`** -- Update `last_heartbeat` to current time and optionally update `status`.

**`listAgents(filters)`** -- Query agents with optional filters: `project`, `type`, `status`, `limit`. Results include parsed `capabilities` and `metadata` JSON, plus computed `heartbeatAge` (ms since last heartbeat).

**`cleanupStaleAgents(timeoutMs)`** -- Mark agents as `'offline'` whose `last_heartbeat` exceeds the timeout (default 300,000ms / 5 minutes).

### Event Operations

**`emitEvent(eventType, agentId, project, payload)`** -- Insert an event with JSON-serialized payload.

**`getEvents(filters)`** -- Query events with optional filters: `eventType`, `agentId`, `project`, `since` (timestamp). Returns up to `limit` (default 50) events in reverse chronological order with parsed JSON payloads.

### HNSW Index Operations

The database instance manages an in-memory `HnswIndex(384)` (from `daemon/lib/hnsw.js`, 384-dim MiniLM-L6-v2) alongside SQLite.

**`initHnsw()`** -- Loads from `~/.quoth/hnsw.index.json` if it exists, otherwise builds from all active patterns with embeddings in the database. Sets `hnswHealthy = true` on success or `false` on any error (fallback to linear scan remains functional).

**`saveHnsw()`** -- Persists the in-memory index to `~/.quoth/hnsw.index.json`. No-op if HNSW is unhealthy.

**`rebuildHnsw()`** -- Full rebuild from database: clears the index, reloads all active patterns with embeddings, saves to disk.

## Cosine Similarity

`cosineDistance(a, b)` is defined in `daemon/lib/hnsw.js` and used by the HNSW index internally. `cosineSimilarity(a, b)` is also defined locally in `daemon/db.js` for the linear scan fallback path. Both share the same implementation:

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

function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b)
}
```

Division-by-zero is guarded: returns 0 if either vector has zero magnitude. `cosineDistance` is used internally by the HNSW index for neighbor comparisons.

## Runtime Migrations

The `createDb()` constructor runs multiple migration blocks on every startup, each idempotent:

1. **Promotion columns:** `promoted_at`, `cloud_document_id`, `promoted_confidence`, `applicability` -- checked via `PRAGMA table_info`.
2. **Bayesian columns:** `alpha` (REAL DEFAULT 1), `beta` (REAL DEFAULT 1).
3. **Namespace column:** `namespace` (TEXT DEFAULT 'default') with `idx_patterns_namespace` index.
4. **Exposure/trigram columns:** `exposure_count`, `last_exposed_at`, `ignored_count`, `embedding_text`, `pattern_trigrams`, `quality_history` -- added via try/catch (duplicate column errors are silently swallowed).
5. **V2 hierarchical Thompson columns:** `cluster_id`, `cluster_rank_score`, `effective_exposures`, `distinctiveness`, `retired_at`, `retired_reason`, `idx_patterns_cluster` index -- via a `v2Migrate()` helper that suppresses "duplicate column / already exists" errors only, re-throwing all others.
6. **Beta repair (one-time):** Resets `alpha = 1, beta = 1, confidence = 0.5` for never-exposed active patterns where `beta > 2.0` (caused by an earlier aggressive decay that incremented beta hourly).
7. **Trigram backfill (one-time):** Generates `pattern_trigrams` for any active pattern where the column is NULL.
8. **MiniLM-L6 migration:** If the first stored embedding has length > 384, all embeddings are nulled out (migration from voyage-4-lite 1536d to MiniLM-L6 384d) and `hnsw.index.json` is deleted.

This approach allows the schema to evolve without a formal migration framework.

## File Layout

```
~/.quoth/
  memory.db              -- SQLite database (WAL mode)
  memory.db-wal          -- WAL file (auto-managed)
  memory.db-shm          -- Shared memory file (auto-managed)
  hnsw.index.json        -- Serialized HNSW graph (JSON)
```
