# MCP Tools Reference

**Version:** 1.0.2 — 2026-04-08

Quoth exposes 22 MCP tools through a single server (`quoth-learning`) using the JSON-RPC 2.0 protocol over stdio. Tools are organized into 4 handler modules: Patterns, Intelligence, Agents, and Skills.

## Table of Contents

- [MCP Server](#mcp-server)
- [Handler Architecture](#handler-architecture)
- [Pattern Tools (8)](#pattern-tools)
- [Intelligence Tools (6)](#intelligence-tools)
- [Agent Tools (6)](#agent-tools)
- [Skill Tools (2)](#skill-tools)

---

## MCP Server

**File:** `mcp/quoth-learning-server.js`

| Property | Value |
|----------|-------|
| Protocol | MCP stdio (JSON-RPC 2.0 over stdin/stdout) |
| Protocol version | `2024-11-05` |
| Server name | `quoth-learning` |
| Server version | `2.0.0` |
| Capabilities | `{ tools: {} }` |
| Database | `~/.quoth/memory.db` (lazy-loaded on first tool call) |

### Protocol Handling

The server reads one JSON message per line from stdin using `readline.createInterface` and writes one JSON response per line to stdout.

**Supported methods:**

| Method | Response |
|--------|----------|
| `initialize` | Returns protocol version, capabilities, and server info |
| `tools/list` | Returns `ALL_TOOLS` array with all 22 tool definitions |
| `tools/call` | Dispatches to the appropriate handler, returns tool result |
| Any other method with `id` | Returns empty result `{}` (acknowledges unknown requests) |

**Error codes:**

| Code | Meaning | When |
|------|---------|------|
| `-32602` | Invalid params | Missing `params.name` in `tools/call` |
| `-32603` | Internal error | Handler throws an exception |

### Lazy Database Loading

The SQLite database is only loaded when the first `tools/call` request arrives. This avoids startup failures if `better-sqlite3` is not installed (the server can still respond to `initialize` and `tools/list`).

```javascript
let _db = null
function getDb() {
  if (_db) return _db
  const { createDb } = require('../daemon/db.js')
  _db = createDb(DB_PATH)
  return _db
}
```

---

## Handler Architecture

**File:** `mcp/handlers/index.js`

The handler index aggregates tools from 4 modules and builds a dispatch map.

### Module Aggregation

```javascript
const ALL_TOOLS = [
  ...patterns.TOOLS,    // 8 tools
  ...skills.TOOLS,      // 2 tools
  ...agents.TOOLS,      // 6 tools
  ...intelligence.TOOLS // 6 tools
]
```

### Dispatch Map

A `HANDLERS` object maps each tool name to its handler module. The `dispatch(name, args, db)` function looks up the handler and calls `handler.handle(name, args, db)`.

Each handler module exports:
- `TOOLS`: Array of tool definitions (name, description, inputSchema)
- `handle(name, args, db)`: Async function that processes tool calls and returns results

If a tool name is not found in the dispatch map, an `"Unknown tool: {name}"` error is thrown. Additionally, if the matched handler returns `null` (its internal default branch), the same error is thrown — so unknown-tool errors can originate from either the dispatch map lookup or the handler itself.

---

## Pattern Tools

**File:** `mcp/handlers/patterns.js`

8 tools for managing the pattern database: recording outcomes, adjusting confidence, searching, promoting, and seeding.

### 1. `quoth_log_outcome`

Record the outcome of using a pattern. This is the primary feedback mechanism for the Bayesian confidence scoring system.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `patternId` | string | yes | Pattern ID that was used |
| `result` | string | yes | `"success"` or `"failure"` |
| `context` | string | no | Optional context about the use |

**Behavior:**

1. If the database supports `applyBayesianUpdate` (current implementation), calls it with the pattern ID and result. This increments `alpha` (on success) or `beta` (on failure) and recalculates the Bayesian confidence score.
2. Falls back to `applyConfidenceDelta(patternId, delta)` with `+0.03` for success, `-0.03` for failure.
3. Fetches and returns the updated pattern.

**Response:**

```json
{
  "logged": true,
  "patternId": "a1b2c3d4e5f6",
  "result": "success",
  "confidence": 0.87
}
```

### 2. `quoth_score_pattern`

Manually adjust a pattern's confidence score. Positive delta triggers a Bayesian success update; negative delta triggers a failure update.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `patternId` | string | yes | Pattern ID to adjust |
| `delta` | number | yes | Confidence delta (e.g., `+0.03` for success, `-0.03` for failure) |

**Behavior:**

The delta direction determines the Bayesian update type:
- `delta > 0` calls `db.applyBayesianUpdate(patternId, 'success')`
- `delta < 0` calls `db.applyBayesianUpdate(patternId, 'failure')`
- `delta === 0` is a no-op

**Response:**

```json
{
  "updated": true,
  "pattern": { "id": "a1b2c3d4e5f6", "name": "...", "confidence": 0.82, ... }
}
```

### 3. `quoth_top_patterns`

Get top-N patterns by confidence score, with optional semantic search and reranking.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `limit` | number | no | 5 | Maximum number of patterns to return |
| `tags` | string[] | no | [] | Filter by tag membership |
| `query` | string | no | (none) | Semantic query for embedding-based search and optional Jina reranking |

**Behavior:**

1. If `query` is provided, generate an embedding via local MiniLM-L6-v2 and search by cosine similarity using `db.searchBySimilarity(queryVec, limit, tags)`.
2. If embedding generation fails or no query, fall back to `db.getTopPatterns(limit, tags)` which returns patterns sorted by confidence.
3. If `query` is provided and `JINA_API_KEY` env var is set and results exist, apply Jina reranking via `rerankPatterns(query, patterns)`.

**Response:**

```json
{
  "patterns": [
    { "id": "...", "name": "...", "confidence": 0.92, "tags": [...], ... },
    ...
  ]
}
```

### 4. `quoth_search_patterns`

Semantic search across local patterns. This is the primary discovery tool for finding patterns related to specific features, error types, or techniques.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | yes | - | Natural language query |
| `limit` | number | no | 5 | Maximum results |
| `tags` | string[] | no | [] | Optional tag filter |
| `includeSkills` | boolean | no | true | Include skill-type patterns in results |

**Behavior:**

1. Generate embedding for the query via local MiniLM-L6-v2 (see [12 — Embeddings & Search](./12-embeddings-search.md)).
2. If embedding succeeds, search by cosine similarity via `db.searchBySimilarity()`.
3. If embedding fails or returns no results, fall back to keyword matching:
   - Fetch `limit * 2` top patterns from the database.
   - Tokenize the query into words (length > 2).
   - Filter patterns where any query word appears in the concatenated `name`, `condition`, `action` fields.
   - Slice to `limit`.
4. If `JINA_API_KEY` is set and more than 1 result, apply Jina reranking.
5. If `includeSkills === false`, filter out patterns where `pattern_type === 'skill'` or `source === 'skill-derived'`.
6. Update `last_matched_at` timestamp on all returned patterns in the database.
7. Write matched IDs (with `pat-` prefix) to `~/.quoth/intelligence/last-matched.json` for the feedback loop (used by `intelligence.applyFeedback()`).

**Response:**

```json
{
  "query": "authentication error handling",
  "count": 3,
  "patterns": [
    { "id": "...", "name": "...", "confidence": 0.85, ... },
    ...
  ]
}
```

### 5. `quoth_project_patterns`

Get patterns relevant to a specific project, including both project-scoped and global patterns.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `project` | string | yes | - | Project namespace (e.g., `"quoth"`, `"sales-companion"`) |
| `limit` | number | no | 10 | Maximum results |

**Behavior:**

Calls `db.getProjectPatterns(project, limit)` which returns patterns matching the project namespace plus patterns in the `global` namespace.

**Response:**

```json
{
  "project": "quoth",
  "count": 5,
  "patterns": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "Auth resilience",
      "condition": "JWT claims may be missing",
      "action": "Use DB fallback for optional fields",
      "confidence": 0.85,
      "namespace": "quoth",
      "tags": ["auth", "jwt"],
      "source": "distilled"
    },
    ...
  ]
}
```

### 6. `quoth_promote_global`

Promote a project-scoped pattern to the global namespace so all projects can benefit from it.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `patternId` | string | yes | Pattern ID to promote |

**Behavior:**

1. Fetch the pattern from the database.
2. If not found, return error.
3. If confidence < 0.6, return error with the actual confidence value.
4. If already in global namespace, return `{ alreadyGlobal: true }`.
5. Call `db.promoteToGlobal(patternId)` to change the namespace.

**Response (success):**

```json
{
  "promoted": true,
  "patternId": "a1b2c3d4e5f6",
  "previousNamespace": "quoth"
}
```

**Response (error):**

```json
{
  "error": "Pattern confidence 0.42 too low (min 0.6 for global promotion)"
}
```

### 7. `quoth_seed_from_exolar`

Import Exolar clustered failure data as pattern candidates. Spawns a Haiku subagent to query the Exolar MCP tool and write JSONL trajectory entries.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `dataset` | string | no | `"clustered_failures"` | Exolar dataset to query |
| `projectId` | string | no | (none) | Filter by project |

**Behavior:**

1. Generate a unique session ID: `exolar-seed-{timestamp}`.
2. Construct a prompt instructing the Haiku subagent to:
   - Query Exolar for clustered failures
   - Write one JSONL line per cluster to `~/.quoth/trajectories/{sessionId}.jsonl`
   - Each line has `event: "exolar_seed"`, `source: "exolar-seeded"`, `outcome: "failure"`
3. Invoke `claude -p --model claude-haiku-4-5-20251001 --output-format text` via `spawnSync` with the prompt as stdin (60-second timeout).
4. The daemon's file watcher picks up the new JSONL file and processes it through the normal pipeline.

**Response:**

```json
{
  "seeded": true,
  "trajectoryFile": "/home/user/.quoth/trajectories/exolar-seed-1712188800000.jsonl"
}
```

### 8. `quoth_propose_update`

Manually promote a local pattern to the Quoth cloud without waiting for the nightly deep consolidation cycle.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `patternId` | string | yes | Local pattern ID to promote |

**Behavior:**

1. Fetch the pattern from the local database.
2. If not found, return error.
3. Call `promotePattern(pattern)` to sync to the Quoth cloud API:
   - Ensures the project exists in the cloud (auto-creates if missing).
   - Sends pattern data including embedding for cloud vector search.
4. On success, call `db.markPromoted(id, documentId, confidence)` to record the promotion.

**Response (success):**

```json
{
  "promoted": true,
  "documentId": "doc_abc123",
  "version": 3,
  "status": "active"
}
```

---

## Intelligence Tools

**File:** `mcp/handlers/intelligence.js`

6 tools for the intelligence graph: routing, initialization, context retrieval, consolidation, diagnostics, and feedback. These tools expose the same functions that hooks use directly (without MCP roundtrip), but through the MCP protocol for interactive use.

### Graph Library (`mcp/lib/graph.js`)

The intelligence tools depend on a graph library providing:

- **`tokenize(text)`**: Lowercase, strip non-alphanumeric, remove stop words (79 English stop words), filter words shorter than 3 characters.
- **`trigrams(words)`**: Generate character-level trigrams from each word. Returns a `Set`.
- **`jaccardSimilarity(setA, setB)`**: Compute Jaccard index (intersection / union) between two trigram sets.
- **`computePageRank(nodes, edges, damping, maxIter)`**: Standard PageRank with dangling node handling. Damping factor 0.85, max 30 iterations, convergence threshold 1e-6.
- **`buildEdges(entries)`**: Build two types of edges:
  - **Temporal edges** (weight 0.5): Between entries from the same source file, in order.
  - **Similarity edges** (weight = Jaccard similarity): Between entries in the same category where trigram Jaccard similarity > 0.3.

### Routing Library (`mcp/lib/routing.js`)

The routing system uses keyword matching against 28 ordered patterns (first match wins). Input is normalized via `stripAccents()` before matching, so patterns work with or without diacritics (e.g., Argentine voseo "arregla" and "arreglá" both match). Patterns are ordered from most-specific intent to broadest domain, and each English pattern has a paired Spanish voseo variant.

| Pattern (regex, case-insensitive) | Agent Type | Notes |
|-----------------------------------|------------|-------|
| `\b(?:fix\|bug\|debug\|broken\|crash\|hotfix\|patch\|error\|not.?working\|fails?\|issue\|troubleshoot\|stacktrace\|exception\|segfault\|undefined\|null.?pointer)\b` | `coder` | Highest priority — explicit fix/debug intent |
| `(?:arregla\|corregi\|roto\|crashea\|no.?funciona\|falla\|problema\|error\|rompio)` | `coder` | Spanish voseo |
| `\b(?:refactor\|rename\|extract\|reorganize\|cleanup\|clean.?up\|simplify\|deduplicate\|dedup\|dry\|modularize\|split.?file\|move.?to\|optimize.?code)\b` | `coder` | |
| `(?:refactorea\|renombra\|reorganiza\|simplifica\|limpia\|optimiza\|modulariza)` | `coder` | Spanish voseo |
| `\b(?:test\|spec\|coverage\|unit.?test\|integration.?test\|assert\|mock\|fixture\|jest\|vitest\|e2e\|playwright\|cypress\|snapshot)\b` | `tester` | |
| `(?:testea\|proba\|pruebas\|test unitario)` | `tester` | Spanish voseo |
| `\b(?:review\|audit\|security.?check\|lint\|inspect\|validate\|code.?quality\|sonar\|eslint)\b` | `reviewer` | |
| `(?:revisa\|audita\|chequea\|valida\|seguridad)` | `reviewer` | Spanish voseo |
| `\b(?:commit\|push\|pull\|merge\|rebase\|cherry.?pick\|stash\|tag\|release\|branch\|checkout\|diff\|log\|blame\|bisect\|amend\|squash\|reset\|revert)\b` | `coder` | Git / version control operations |
| `(?:comitear\|pushear\|mergear\|branchear\|taggear\|releasear)` | `coder` | Spanish voseo |
| `\b(?:readme\|changelog\|write.?doc\|update.?doc\|jsdoc\|typedoc\|comment\|annotate\|document(?:ation)?)\b` | `researcher` | Documentation writing intent |
| `(?:documenta\|escribi.?doc\|anota\|comenta)` | `researcher` | Spanish voseo |
| `\b(?:research\|explore\|investigate\|look.?up\|summarize\|find.?out\|compare\|benchmark\|evaluate\|analyze\|assess)\b` | `researcher` | |
| `(?:investiga\|busca\|explora\|analiza\|resumi\|compara\|evalua)` | `researcher` | Spanish voseo |
| `\b(?:design\|architect\|blueprint\|diagram\|schema\|model\|system.?design\|data.?model\|erd\|uml\|sequence.?diagram)\b` | `architect` | |
| `(?:disena\|arquitectura\|planifica\|diagrama\|esquema\|modela)` | `architect` | Spanish voseo |
| `\b(?:config(?:ure)?\|setup\|install\|env(?:ironment)?\|settings\|\.env\|yaml\|toml\|ini\|dotfile\|eslintrc\|tsconfig\|package\.json)\b` | `devops` | Config/setup intent |
| `(?:configura\|instala\|entorno\|configuracion)` | `devops` | Spanish voseo |
| `\b(?:deploy\|docker\|ci.?cd\|pipeline\|infrastructure\|vercel\|nginx\|systemd\|cron\|kubernetes\|k8s\|terraform\|ansible\|aws\|gcp\|azure\|cloudflare\|ssl\|cert\|dns\|domain)\b` | `devops` | |
| `(?:desplega\|desplegar\|infraestructura\|servidor\|despliegue)` | `devops` | Spanish voseo |
| `\b(?:implement\|create\|build\|add\|develop\|scaffold\|generate\|write.?code\|programa\|code\|make\|new.?file\|new.?function\|new.?class\|new.?module)\b` | `coder` | Broad coder intent |
| `(?:implementa\|crea\|construi\|agrega\|desarrolla\|genera\|hace\|programa)` | `coder` | Spanish voseo |
| `\b(?:api\|endpoint\|backend\|database\|migration\|postgres\|sqlite\|prisma\|drizzle\|query\|sql\|seed\|orm\|graphql\|rest\|webhook\|middleware\|auth(?:entication)?\|jwt\|oauth\|session)\b` | `backend-dev` | Domain match |
| `(?:base.?de.?datos\|migracion\|consulta\|semilla)` | `backend-dev` | Spanish voseo |
| `\b(?:ui\|frontend\|component\|react\|css\|style\|layout\|responsive\|tailwind\|shadcn\|animation\|modal\|form\|button\|page\|view\|route\|navigation\|theme\|dark.?mode)\b` | `frontend-dev` | Domain match |
| `(?:interfaz\|estilo\|pantalla\|formulario\|boton\|navegacion\|tema)` | `frontend-dev` | Spanish voseo |
| `^(?:what\|how\|why\|when\|where\|who\|which\|can you\|could you\|tell me\|show me\|explain\|describe\|check\|verify\|status\|is there\|are there\|do we\|does it\|list\|help)\b` | `researcher` | Conversational/questions — **0.6 confidence** |
| `^(?:que\|como\|por ?que\|cuando\|donde\|quien\|cual\|podes\|podrias\|decime\|mostrame\|explica\|describi\|chequea\|verifica\|hay\|tenemos\|ayuda)[\s?]` | `researcher` | Spanish conversational — **0.6 confidence** |

Default (no match): `coder` at 0.5 confidence.

Agent capabilities map (for context):

| Agent Type | Capabilities |
|------------|-------------|
| `coder` | code-generation, refactoring, debugging, implementation |
| `tester` | unit-testing, integration-testing, coverage, test-generation |
| `reviewer` | code-review, security-audit, quality-check, best-practices |
| `researcher` | web-search, documentation, analysis, summarization |
| `architect` | system-design, architecture, patterns, scalability |
| `backend-dev` | api, database, server, authentication |
| `frontend-dev` | ui, react, css, components |
| `devops` | ci-cd, docker, deployment, infrastructure |

### 9. `quoth_route_task`

Route a task to the optimal agent type based on keyword matching and learned patterns.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task` | string | yes | Task description to route |

**Behavior:**

1. Call `routeTask(task)` for keyword-based matching against `TASK_PATTERNS`.
2. Call `getAlternatives(primaryAgent)` to get 2 alternative agent types (the first two agent types not matching the primary, with decreasing confidence: 0.6, 0.5).
3. Call `getContext(task, 3)` to find up to 3 relevant intelligence entries for the task.
4. Return combined result.

**Response:**

```json
{
  "agent": "coder",
  "confidence": 0.8,
  "reason": "Matched pattern: implement|create|build|add|write code",
  "alternatives": [
    { "agent": "tester", "confidence": 0.6, "reason": "Alternative agent for tester capabilities" },
    { "agent": "reviewer", "confidence": 0.5, "reason": "Alternative agent for reviewer capabilities" }
  ],
  "relevantPatterns": [
    { "id": "pat-abc123", "summary": "Use TDD for new features", "score": 0.342, "confidence": 0.75, "pageRank": 0.0234, "accessCount": 5 }
  ]
}
```

### 10. `quoth_intelligence_init`

Initialize the intelligence graph from memory files and the pattern database. Should be called at session start.

**Parameters:** None.

**Behavior:**

1. Check for existing `graph-state.json`. If the node count matches the current store and the graph is less than 60 seconds old, return cache hit.
2. Load or bootstrap the entry store:
   - Parse `.md` files from `~/.claude/projects/*/memory/` (Claude Code project memories).
   - Parse `.md` files from `~/.quoth/memory/`.
   - Load top 50 patterns from SQLite (as `pat-{id}` entries with `type: 'pattern'`).
3. Build graph: create nodes, compute edges (temporal + similarity), run PageRank.
4. Save `graph-state.json`, `store.json`, and `ranked-context.json`.

**Response:**

```json
{
  "nodes": 47,
  "edges": 23,
  "message": "Graph built and ranked"
}
```

### 11. `quoth_intelligence_context`

Get ranked context entries relevant to a prompt using trigram matching weighted by PageRank.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `prompt` | string | yes | - | The prompt to find context for |
| `topK` | number | no | 5 | Number of results to return |

**Behavior:**

1. Load `ranked-context.json` (precomputed by `initGraph` or `consolidateGraph`).
2. Compute trigrams for the prompt.
3. For each entry, compute a score: `0.6 * jaccardSimilarity(promptTrigrams, entryTrigrams) + 0.4 * pageRank`.
4. Filter entries with score >= 0.05.
5. Sort by score descending, take top K.
6. Write matched IDs to `last-matched.json` for the feedback loop.

**Response:**

```json
{
  "count": 3,
  "entries": [
    {
      "id": "pat-a1b2c3d4e5f6",
      "summary": "Auth must not hard-fail on missing JWT claims",
      "score": 0.423,
      "confidence": 0.850,
      "pageRank": 0.0847,
      "accessCount": 5
    },
    ...
  ]
}
```

### 12. `quoth_intelligence_consolidate`

Process pending edits, refresh from the pattern DB, apply confidence decay, rebuild the graph, and recompute PageRank. Should be called at session end.

**Parameters:** None.

**Behavior:**

1. Load `store.json`.
2. Process `pending-insights.jsonl`: files edited 3+ times become "frequently edited" insight entries (type: `procedural`, namespace: `insights`, auto-generated flag set).
3. Clear the pending insights file.
4. Refresh from pattern DB: add any new patterns not already in the store.
5. Apply confidence decay: entries with 0 access count and age > 24 hours lose 0.005 per day, minimum 0.05.
6. Rebuild edges and recompute PageRank.
7. Save `graph-state.json`, `ranked-context.json`, and `store.json` (if new entries).
8. Save snapshot to `snapshots.json` (max 50 kept) with:
   - Timestamp
   - Node and edge counts
   - PageRank sum
   - Confidence and access count distributions
   - Top 10 patterns summary

**Response:**

```json
{
  "entries": 52,
  "edges": 28,
  "newEntries": 3,
  "message": "Consolidated"
}
```

### 13. `quoth_intelligence_stats`

Get comprehensive intelligence diagnostics for debugging and monitoring.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `json` | boolean | no | true | Return as JSON (always true, parameter exists for future formatting options) |

**Response:**

```json
{
  "graph": {
    "nodes": 47,
    "edges": 23,
    "density": 0.0213
  },
  "confidence": {
    "min": 0.050,
    "max": 0.950,
    "mean": 0.523
  },
  "access": {
    "total": 142,
    "used": 28
  },
  "pageRank": {
    "topNode": "pat-a1b2c3d4e5f6",
    "topNodeRank": 0.0847
  },
  "edgeTypes": {
    "temporal": 12,
    "similar": 11
  },
  "pendingInsights": 3,
  "snapshots": 15,
  "topPatterns": [
    {
      "rank": 1,
      "summary": "Auth resilience with DB fallback",
      "confidence": 0.850,
      "pageRank": 0.0847,
      "accessed": 5
    },
    ...
  ],
  "delta": {
    "elapsed": "45m",
    "nodes": 2,
    "edges": 1
  },
  "exposure": {
    "total": 100,
    "exposed": 45,
    "used": 22,
    "avg_conversion_rate": 0.1234
  },
  "v2": {
    "clusters": {
      "count": 12,
      "avg_conf": 0.650,
      "min_conf": 0.100,
      "max_conf": 0.950,
      "total_attempts": 300
    },
    "injections_7d": {
      "total": 150,
      "explorations": 20,
      "avg_propensity": 0.450,
      "with_outcome": 80,
      "avg_reward": 0.750
    },
    "judge_30d": {
      "total": 200,
      "judged": 180,
      "cost_cents": 1.50
    },
    "retired_total": 5
  }
}
```

**Field descriptions:**

| Field | Description |
|-------|-------------|
| `graph.density` | Graph density: `2 * edges / (nodes * (nodes - 1))`. Higher density means more connections. |
| `access.total` | Sum of all access counts across all nodes |
| `access.used` | Number of nodes that have been accessed at least once |
| `pageRank.topNode` | ID of the node with the highest PageRank score |
| `pendingInsights` | Number of unprocessed lines in `pending-insights.jsonl` |
| `snapshots` | Number of historical snapshots in `snapshots.json` |
| `delta` | Comparison between the two most recent snapshots (null if < 2 snapshots) |
| `exposure` | Pattern exposure stats from SQLite `patterns` table (null if DB unavailable). `exposed` = patterns shown at least once; `used` = patterns that resulted in a success. |
| `exposure.avg_conversion_rate` | Average `success_count / exposure_count` across exposed active patterns |
| `v2` | Extended v2 telemetry (null if DB tables not present). Requires `cluster_stats`, `injection_log`, and `judge_queue` tables. |
| `v2.clusters` | Cluster stats: count, confidence distribution, and total attempts across all clusters |
| `v2.injections_7d` | Pattern injection activity in the last 7 days: totals, explorations (ε-greedy), propensity scores, and average reward |
| `v2.judge_30d` | JUDGE pipeline activity in the last 30 days: total enqueued, judged count, and cost in cents |
| `v2.retired_total` | Total number of patterns with a `retired_at` timestamp |

### 14. `quoth_intelligence_feedback`

Record success or failure feedback for the most recently matched patterns. Reads from `last-matched.json` (written by `getContext()` and `quoth_search_patterns`).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `success` | boolean | yes | Whether the task succeeded |

**Behavior:**

1. Read `last-matched.json` to get IDs of recently matched patterns.
2. If no matched IDs, return `{ boosted: [] }`.
3. Apply confidence adjustment to matched entries in `ranked-context.json` and `graph-state.json`:
   - Success: `+0.05` confidence (clamped to [0, 1])
   - Failure: `-0.02` confidence (clamped to [0, 1])
4. Increment `accessCount` on all matched entries.
5. Save both JSON files.

**Response:**

```json
{
  "boosted": ["pat-a1b2c3d4e5f6", "mem-auth-resilience"],
  "amount": 0.05
}
```

---

## Agent Tools

**File:** `mcp/handlers/agents.js`

6 tools for agent coordination: daemon status, trajectory ingestion, registration, heartbeat, listing, and task assignment.

### 15. `quoth_daemon_status`

Check if the Quoth learning daemon is running and retrieve recent log output.

**Parameters:** None.

**Behavior:**

1. Check if `~/.quoth/daemon.pid` exists.
2. If exists, read the PID and verify the process is alive via `process.kill(pid, 0)`.
3. If alive, read the last 3 lines of `~/.quoth/daemon.log`.

**Response (running):**

```json
{
  "running": true,
  "pid": 12345,
  "lastLog": "{\"ts\":\"...\",\"level\":\"info\",\"msg\":\"Enqueued 2 new entries\"}\n...",
  "costSummary": {
    "today": { "total_calls": 5, "total_cost_usd": 0.012, "by_stage": { "JUDGE": { "calls": 3, "cost": 0.008, "input_tokens": 4200, "output_tokens": 1100, "model": "haiku" }, "DISTILL": { "calls": 2, "cost": 0.004, "input_tokens": 2800, "output_tokens": 900, "model": "haiku" } } },
    "week": { "total_calls": 28, "total_cost_usd": 0.067, "by_stage": { "..." : "..." } },
    "all_time": { "total_calls": 142, "total_cost_usd": 0.31, "by_stage": { "..." : "..." } }
  }
}
```

The `costSummary` field contains pipeline LLM cost breakdowns across three time ranges (`today`, `week`, `all_time`). Each range is produced by `db.getCostSummary(range?)` and contains `total_calls`, `total_cost_usd`, and a `by_stage` map keyed by pipeline stage name (e.g., `JUDGE`, `DISTILL`, `CONSOLIDATE`). Each stage entry includes `calls`, `cost` (USD), `input_tokens`, `output_tokens`, and `model`. The field is `null` if cost tracking data is unavailable.

**Response (not running):**

```json
{
  "running": false,
  "stalePid": 12345
}
```

### 16. `quoth_ingest_trajectory`

Batch ingest trajectory entries from external sources (OpenClaw agents, API clients, batch imports).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `entries` | array | yes | Array of trajectory entry objects |

**Entry object schema:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `event` | string | no | `"tool_use"` | Event type |
| `agent` | string | yes | - | Agent name/identifier |
| `project` | string | no | `"unknown"` | Project namespace |
| `task` | string | yes | - | What the agent was doing |
| `outcome` | string | yes | - | `"success"` or `"failure"` |
| `pattern_used` | string | no | `null` | Pattern that was applied |
| `source` | string | no | `"api"` | Source identifier |

**Behavior:**

1. Write all entries as JSONL lines to `~/.quoth/trajectories/{source}-{YYYY-MM-DD}.jsonl`.
2. If the daemon is running (PID file exists and process alive), send `SIGUSR1` signal to trigger immediate processing.
3. Each entry gets a `session` field (`ingest-{timestamp}`) and `timestamp` (current time) added.

**Response:**

```json
{
  "ingested": 5,
  "trajectoryFile": "/home/user/.quoth/trajectories/api-2026-04-04.jsonl",
  "daemonSignaled": true
}
```

### 17. `quoth_agent_register`

Register or update an agent in the Quoth coordination layer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Unique agent identifier |
| `name` | string | yes | Human-readable name |
| `type` | string | yes | One of: `"claude-code"`, `"openclaw"`, `"daemon"`, `"worker"` |
| `project` | string | no | Associated project |
| `platform` | string | no | Platform identifier |
| `capabilities` | string[] | no | List of capability tags |
| `metadata` | object | no | Arbitrary metadata |

**Behavior:**

1. Call `db.registerAgent()` to upsert the agent record in SQLite.
2. Emit `agent.registered` event to the event log with name, type, and platform.

**Response:**

```json
{
  "registered": true,
  "agentId": "claude-code-quoth-main"
}
```

### 18. `quoth_agent_heartbeat`

Send a heartbeat to keep an agent's status as online. Agents that miss heartbeats for 5 minutes are marked offline by the daemon's cleanup timer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent identifier |
| `status` | string | no | One of: `"online"`, `"busy"`, `"idle"` (default: last known) |

**Behavior:**

Calls `db.heartbeat(agentId, status)` to update the agent's `last_heartbeat` timestamp and optional status.

**Response:**

```json
{
  "ok": true,
  "agentId": "claude-code-quoth-main",
  "timestamp": 1712188800000
}
```

### 19. `quoth_agent_list`

List registered agents with optional filtering.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `project` | string | no | (all) | Filter by project |
| `type` | string | no | (all) | Filter by type |
| `status` | string | no | (all) | Filter by status: `"online"`, `"offline"`, `"busy"`, `"idle"` |
| `limit` | number | no | 20 | Maximum results |

**Behavior:**

Calls `db.listAgents({ project, type, status, limit })` to query the agents table with optional filters.

**Response:**

```json
{
  "count": 3,
  "agents": [
    {
      "agent_id": "claude-code-quoth-main",
      "name": "Quoth Main",
      "type": "claude-code",
      "project": "quoth",
      "status": "online",
      "last_heartbeat": 1712188800000,
      ...
    },
    ...
  ]
}
```

### 20. `quoth_assign_task`

Assign a task to an agent via the event system.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `agentId` | string | yes | - | Target agent ID |
| `task` | string | yes | - | Task description |
| `priority` | string | no | `"medium"` | One of: `"low"`, `"medium"`, `"high"`, `"critical"` |
| `metadata` | object | no | {} | Arbitrary task metadata |

**Behavior:**

1. Look up the target agent in the database to get its associated project.
2. Call `db.emitEvent('task.assigned', agentId, project, ...)` to create an event record with the task description, priority, and metadata.
3. The `assignedBy` field is set to `"mcp"`.

**Response:**

```json
{
  "assigned": true,
  "eventId": 42,
  "agentId": "claude-code-quoth-main",
  "task": "Implement user authentication middleware"
}
```

---

## Skill Tools

**File:** `mcp/handlers/skills.js`

2 tools for extracting and listing reusable test skills from passing tests.

### 21. `quoth_extract_skill`

Extract a reusable test skill (parameterized recipe) from a passing test file using Claude Sonnet 4.6.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `testFile` | string | yes | Path to the passing test file |
| `feature` | string | no | Feature name for context (defaults to basename of testFile without `.spec.ts` extension) |

**Behavior:**

1. Call `extractSkill({ testFile, feature })` from the skill extraction library, which invokes Sonnet 4.6 to analyze the test file and extract a parameterized recipe.
2. If extraction fails, return error.
3. Generate a skill ID: `skill-{sha1(skill.name).slice(0, 12)}`.
4. Store the skill as a pattern in SQLite via `db.upsertPattern()`:

   | Field | Value |
   |-------|-------|
   | `id` | `skill-{hash}` |
   | `name` | Skill name from extraction |
   | `pattern_type` | `'skill'` |
   | `condition` | Skill description |
   | `action` | Skill template (with `{{variable}}` placeholders) |
   | `confidence` | `0.85` (high initial confidence since derived from passing tests) |
   | `tags` | Assertions + page objects from the extraction |
   | `source` | `'skill-derived'` |

**Response:**

```json
{
  "extracted": true,
  "skill": {
    "name": "login-flow-verification",
    "description": "Verify user login with email and password",
    "template": "Navigate to {{login_url}}, enter {{email}} and {{password}}, click submit, verify redirect to {{dashboard_url}}",
    "params": ["login_url", "email", "password", "dashboard_url"],
    "selectors": ["input[name=email]", "input[name=password]", "button[type=submit]"],
    "pageObjects": ["LoginPage", "DashboardPage"],
    "assertions": ["url-redirect", "element-visible"]
  }
}
```

### 22. `quoth_list_skills`

List all skill-type patterns from the database.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tags` | string[] | no | Filter by tags |

**Behavior:**

1. Fetch top 50 patterns from the database, optionally filtered by tags.
2. Filter to patterns where `source === 'skill-derived'` or `pattern_type === 'skill'`.

**Response:**

```json
{
  "skills": [
    {
      "id": "skill-a1b2c3d4e5f6",
      "name": "login-flow-verification",
      "pattern_type": "skill",
      "confidence": 0.85,
      "source": "skill-derived",
      ...
    },
    ...
  ]
}
```

---

## Tool Summary Table

| # | Tool Name | Module | Parameters | Description |
|---|-----------|--------|------------|-------------|
| 1 | `quoth_log_outcome` | patterns | patternId, result, context? | Record success/failure via Bayesian update |
| 2 | `quoth_score_pattern` | patterns | patternId, delta | Manual confidence adjustment |
| 3 | `quoth_top_patterns` | patterns | limit?, tags?, query? | Top patterns by confidence with optional semantic search |
| 4 | `quoth_search_patterns` | patterns | query, limit?, tags?, includeSkills? | Semantic search via embeddings + keyword fallback |
| 5 | `quoth_project_patterns` | patterns | project, limit? | Project-scoped + global patterns |
| 6 | `quoth_promote_global` | patterns | patternId | Promote to global namespace (min 0.6 confidence) |
| 7 | `quoth_seed_from_exolar` | patterns | dataset?, projectId? | Import Exolar failures as pattern candidates |
| 8 | `quoth_propose_update` | patterns | patternId | Manual cloud promotion |
| 9 | `quoth_route_task` | intelligence | task | Route task to optimal agent type |
| 10 | `quoth_intelligence_init` | intelligence | (none) | Initialize intelligence graph |
| 11 | `quoth_intelligence_context` | intelligence | prompt, topK? | Get ranked context entries for prompt |
| 12 | `quoth_intelligence_consolidate` | intelligence | (none) | Consolidate graph at session end |
| 13 | `quoth_intelligence_stats` | intelligence | json? | Comprehensive diagnostics |
| 14 | `quoth_intelligence_feedback` | intelligence | success | Record feedback for last-matched patterns |
| 15 | `quoth_daemon_status` | agents | (none) | Check daemon status |
| 16 | `quoth_ingest_trajectory` | agents | entries[] | Batch ingest from external sources |
| 17 | `quoth_agent_register` | agents | agentId, name, type, ... | Register agent |
| 18 | `quoth_agent_heartbeat` | agents | agentId, status? | Keep agent online |
| 19 | `quoth_agent_list` | agents | project?, type?, status?, limit? | List agents with filtering |
| 20 | `quoth_assign_task` | agents | agentId, task, priority?, metadata? | Assign task via event system |
| 21 | `quoth_extract_skill` | skills | testFile, feature? | Extract reusable test skill |
| 22 | `quoth_list_skills` | skills | tags? | List all skill-type patterns |
