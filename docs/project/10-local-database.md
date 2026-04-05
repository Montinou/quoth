# Local Database (SQLite)

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

The schema defines 6 tables, created via `CREATE TABLE IF NOT EXISTS` on every startup.

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
| `embedding` | TEXT | NULL | JSON-serialized float array (1024-dim voyage-4-lite vector) |
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

**`applyHourlyDecay()`** -- Called by the daemon on a schedule. Four operations:
1. **Alpha decay:** For all active patterns, reduce alpha by `decay_rate * alpha * 0.01` with floor at 0.1. Confidence floor at 0.05.
2. **Tier 1 — Never matched:** Patterns with `last_matched_at IS NULL` and zero feedback get `beta += 0.1` (aggressive — drops to ~0.3 in a week).
3. **Tier 2 — Inactive >7 days:** Patterns matched before but idle >7 days get `beta += 0.05` (moderate).
4. **Tier 3 — Inactive >30 days:** All patterns idle >30 days get `beta += 0.15` (strong, stacks with Tier 1 or 2).

**`archiveWeakPatterns()`** -- Two rules:
1. Set `status = 'archived'` for patterns where `confidence < 0.1` AND total uses > 3 (evidence-based archival).
2. Archive raw tool-call patterns (`name LIKE 'claude-code: Bash %'` etc.) with `confidence < 0.15` and zero feedback (garbage cleanup).

**`getPromotionCandidates()`** -- Find patterns eligible for cloud promotion: `confidence > 0.8`, total uses > 10, `status = 'active'`, `source = 'distilled'`.

**`markPromoted(id, cloudDocumentId, confidence)`** -- Record promotion metadata: sets `promoted_at`, `cloud_document_id`, and `promoted_confidence` snapshot.

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

The database instance manages an in-memory `HnswIndex` (from `daemon/lib/hnsw.js`) alongside SQLite.

**`initHnsw()`** -- Loads from `~/.quoth/hnsw.index.json` if it exists, otherwise builds from all active patterns with embeddings in the database. Sets `hnswHealthy = true` on success or `false` on any error (fallback to linear scan remains functional).

**`saveHnsw()`** -- Persists the in-memory index to `~/.quoth/hnsw.index.json`. No-op if HNSW is unhealthy.

**`rebuildHnsw()`** -- Full rebuild from database: clears the index, reloads all active patterns with embeddings, saves to disk.

## Cosine Similarity

The `cosineSimilarity(a, b)` function is implemented inline in `db.js` for the linear scan fallback path:

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

Division-by-zero is guarded: returns 0 if either vector has zero magnitude.

## Runtime Migrations

The `createDb()` constructor runs three migration blocks on every startup, checking `PRAGMA table_info(patterns)` before each:

1. **Promotion columns:** `promoted_at` (INTEGER), `cloud_document_id` (TEXT), `promoted_confidence` (REAL), `applicability` (TEXT DEFAULT 'narrow')
2. **Bayesian columns:** `alpha` (REAL DEFAULT 1), `beta` (REAL DEFAULT 1)
3. **Namespace column:** `namespace` (TEXT DEFAULT 'default') with `idx_patterns_namespace` index

Each migration is idempotent -- columns are only added if not already present. This approach allows the schema to evolve without a formal migration framework.

## File Layout

```
~/.quoth/
  memory.db              -- SQLite database (WAL mode)
  memory.db-wal          -- WAL file (auto-managed)
  memory.db-shm          -- Shared memory file (auto-managed)
  hnsw.index.json        -- Serialized HNSW graph (JSON)
```
