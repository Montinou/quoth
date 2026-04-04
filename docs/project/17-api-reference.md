# API Reference

Complete API reference for the Quoth system. Covers both the local MCP tool interface (22 tools via the `quoth-learning` server) and the SaaS REST API endpoints deployed on Vercel.

---

## MCP Server Protocol

The MCP server (`quoth-plugin/mcp/quoth-learning-server.js`) communicates over **stdio** using JSON-RPC 2.0 (MCP protocol version `2024-11-05`). It lazy-loads a `better-sqlite3` database from `~/.quoth/memory.db`.

**Lifecycle:**
1. Client sends `initialize` -- server responds with capabilities (`{ tools: {} }`).
2. Client sends `tools/list` -- server returns all 22 tool definitions.
3. Client sends `tools/call` with `{ name, arguments }` -- server dispatches to the appropriate handler module and returns `{ content: [{ type: 'text', text: <JSON> }] }`.

**Handler Modules:**

| Module | File | Tools |
|--------|------|-------|
| Patterns | `mcp/handlers/patterns.js` | 8 tools |
| Intelligence | `mcp/handlers/intelligence.js` | 6 tools |
| Agents | `mcp/handlers/agents.js` | 6 tools |
| Skills | `mcp/handlers/skills.js` | 2 tools |

Dispatch is managed by `mcp/handlers/index.js`, which builds a `toolName -> module` map at startup and delegates `handle(name, args, db)` calls.

---

## MCP Tools: Pattern Tools (8)

### quoth_log_outcome

Record the outcome of using a pattern. Feeds Bayesian confidence scoring.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patternId` | string | Yes | Pattern ID that was used |
| `result` | `'success'` \| `'failure'` | Yes | Outcome of pattern application |
| `context` | string | No | Optional context about the use |

**Returns:**
```json
{
  "logged": true,
  "patternId": "abc123",
  "result": "success",
  "confidence": 0.72
}
```

**Behavior:** If the database supports `applyBayesianUpdate()`, uses Beta distribution updates. Otherwise falls back to a +/- 0.03 confidence delta via `applyConfidenceDelta()`.

---

### quoth_score_pattern

Manually adjust a pattern's confidence score.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patternId` | string | Yes | Pattern ID to adjust |
| `delta` | number | Yes | Confidence delta (positive = success, negative = failure) |

**Returns:**
```json
{
  "updated": true,
  "pattern": { "id": "...", "name": "...", "confidence": 0.75, ... }
}
```

**Behavior:** Positive deltas trigger a Bayesian `success` update; negative deltas trigger a `failure` update. The raw delta value is not applied directly -- it only determines the direction.

---

### quoth_top_patterns

Get top-N patterns by confidence score, with optional semantic search and Jina reranking.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | number | No | 5 | Maximum patterns to return |
| `tags` | string[] | No | `[]` | Filter by tags |
| `query` | string | No | - | Semantic query -- triggers embedding search and optional Jina reranking |

**Returns:**
```json
{
  "patterns": [
    { "id": "...", "name": "...", "confidence": 0.85, "condition": "...", "action": "...", ... }
  ]
}
```

**Behavior:**
1. If `query` is provided, generates an embedding via `daemon/lib/embed.js` and performs HNSW similarity search.
2. Falls back to confidence-sorted retrieval if embedding generation fails.
3. If `JINA_API_KEY` is set and `query` is provided, applies Jina reranking to results.

---

### quoth_search_patterns

Search local patterns by semantic similarity. Primary tool for finding patterns related to specific features, error types, or techniques.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Natural language query |
| `limit` | number | No | 5 | Maximum patterns to return |
| `tags` | string[] | No | `[]` | Optional tag filter |
| `includeSkills` | boolean | No | `true` | Include skill-type patterns in results |

**Returns:**
```json
{
  "query": "error handling in API routes",
  "count": 3,
  "patterns": [
    { "id": "...", "name": "...", "confidence": 0.82, "condition": "...", "action": "...", ... }
  ]
}
```

**Behavior:**
1. Generates query embedding and performs HNSW vector search.
2. Falls back to keyword matching (word overlap on `name`, `condition`, `action`) if embedding fails.
3. Applies Jina reranking if `JINA_API_KEY` is set and multiple results exist.
4. Filters out skill-type patterns when `includeSkills` is `false`.
5. Updates `last_matched_at` on returned patterns for decay tracking.
6. Writes matched pattern IDs to `~/.quoth/intelligence/last-matched.json` for the feedback loop.

---

### quoth_project_patterns

Get patterns relevant to a specific project (project-scoped + global patterns).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | Yes | - | Project namespace (derived from git remote) |
| `limit` | number | No | 10 | Maximum patterns to return |

**Returns:**
```json
{
  "project": "quoth",
  "count": 5,
  "patterns": [
    {
      "id": "...", "name": "...", "condition": "...", "action": "...",
      "confidence": 0.78, "namespace": "quoth", "tags": [...], "source": "distilled"
    }
  ]
}
```

---

### quoth_promote_global

Promote a project-local pattern to global scope so all projects benefit.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patternId` | string | Yes | Pattern ID to promote |

**Returns:**
```json
{ "promoted": true, "patternId": "abc123", "previousNamespace": "my-project" }
```

**Error conditions:**
- Pattern not found: `{ "error": "Pattern 'X' not found" }`
- Confidence too low (< 0.6): `{ "error": "Pattern confidence 0.45 too low (min 0.6 for global promotion)" }`
- Already global: `{ "alreadyGlobal": true, "patternId": "abc123" }`

---

### quoth_seed_from_exolar

Import Exolar clustered failures as pattern candidates via a Haiku subagent.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `dataset` | string | No | `'clustered_failures'` | Exolar dataset name |
| `projectId` | string | No | - | Filter by project |

**Returns:**
```json
{ "seeded": true, "trajectoryFile": "/home/user/.quoth/trajectories/exolar-seed-1712000000000.jsonl" }
```

**Behavior:** Spawns a `claude-haiku-4-5-20251001` subprocess with a prompt to query Exolar data and write JSONL trajectory entries. The daemon then processes these trajectories asynchronously.

---

### quoth_propose_update

Manually promote a high-confidence local pattern to the Quoth cloud index without waiting for the nightly cycle.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patternId` | string | Yes | Local pattern ID to promote |

**Returns:**
```json
{ "promoted": true, "documentId": "doc-uuid", "version": 2, "status": "updated" }
```

**Behavior:** Calls `daemon/lib/promote.js` to push the pattern to the Quoth SaaS API (`POST /api/v1/patterns/promote`). Requires `QUOTH_API_KEY` to be set. On success, marks the pattern as promoted locally with `db.markPromoted()`.

---

## MCP Tools: Intelligence Tools (6)

### quoth_route_task

Route a task to the optimal agent type based on keyword matching and learned patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task description to route |

**Returns:**
```json
{
  "agent": "backend-dev",
  "confidence": 0.8,
  "reason": "Matched pattern: api|endpoint|server|backend|database",
  "alternatives": [
    { "agent": "coder", "confidence": 0.6, "reason": "Alternative agent for coder capabilities" },
    { "agent": "tester", "confidence": 0.5, "reason": "Alternative agent for tester capabilities" }
  ],
  "relevantPatterns": [
    { "id": "pat-123", "summary": "REST API error handling", "score": 0.234, ... }
  ]
}
```

**Agent types:** `coder`, `tester`, `reviewer`, `researcher`, `architect`, `backend-dev`, `frontend-dev`, `devops`.

**Routing patterns (from `mcp/lib/routing.js`):**

| Pattern (regex) | Routes to |
|-----------------|-----------|
| `implement\|create\|build\|add\|write code` | coder |
| `test\|spec\|coverage\|unit test\|integration` | tester |
| `review\|audit\|check\|validate\|security` | reviewer |
| `research\|find\|search\|documentation\|explore` | researcher |
| `design\|architect\|structure\|plan` | architect |
| `api\|endpoint\|server\|backend\|database` | backend-dev |
| `ui\|frontend\|component\|react\|css\|style` | frontend-dev |
| `deploy\|docker\|ci\|cd\|pipeline\|infrastructure` | devops |

Default fallback: `coder` at confidence `0.5`.

---

### quoth_intelligence_init

Initialize the intelligence graph from memory entries and patterns. Called automatically at session start.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | - | - | - |

**Returns:**
```json
{ "nodes": 42, "edges": 87, "message": "Graph built and ranked" }
```

**Behavior:**
1. Bootstraps entries from `~/.claude/projects/*/memory/*.md` and `~/.quoth/memory/` files.
2. Loads top 50 patterns from the SQLite database.
3. Builds trigram-based edges between entries using `graph.js` `buildEdges()`.
4. Computes PageRank (damping factor 0.85, 30 iterations).
5. Writes `graph-state.json`, `ranked-context.json`, and `store.json` to `~/.quoth/intelligence/`.
6. Returns cache hit if graph is less than 60 seconds old and node count is unchanged.

**Ranking formula:** Entries are sorted by `0.6 * pageRank + 0.4 * confidence`.

---

### quoth_intelligence_context

Get ranked context entries relevant to a prompt. Uses trigram matching + PageRank.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The prompt to find context for |
| `topK` | number | No | 5 | Maximum entries to return |

**Returns:**
```json
{
  "count": 3,
  "entries": [
    {
      "id": "pat-abc",
      "summary": "REST API error handling patterns",
      "score": 0.456,
      "confidence": 0.820,
      "pageRank": 0.0234,
      "accessCount": 7
    }
  ]
}
```

**Scoring formula:** `0.6 * trigramJaccardSimilarity + 0.4 * pageRank`. Minimum threshold: `0.05`.

---

### quoth_intelligence_consolidate

Process pending edits, rebuild graph edges, recompute PageRank. Called automatically at session end and pre-compact.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | - | - | - |

**Returns:**
```json
{ "entries": 45, "edges": 92, "newEntries": 2, "message": "Consolidated" }
```

**Behavior:**
1. Reads `pending-insights.jsonl` for frequently-edited files (>= 3 edits) and creates insight entries.
2. Refreshes patterns from the SQLite database (adds any new patterns).
3. Applies confidence decay for unaccessed entries (older than 24h): `-0.005 per day`, minimum `0.05`.
4. Rebuilds all graph edges and recomputes PageRank.
5. Saves a snapshot to `snapshots.json` (max 50 retained).
6. Clears the pending insights file.

---

### quoth_intelligence_stats

Get intelligence diagnostics: graph health, confidence distribution, PageRank, and trends.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `json` | boolean | No | `true` | Return structured JSON |

**Returns:**
```json
{
  "graph": { "nodes": 42, "edges": 87, "density": 0.1012 },
  "confidence": { "min": 0.050, "max": 0.950, "mean": 0.623 },
  "access": { "total": 156, "used": 28 },
  "pageRank": { "topNode": "pat-abc", "topNodeRank": 0.0456 },
  "edgeTypes": { "trigram": 65, "namespace": 22 },
  "pendingInsights": 3,
  "snapshots": 12,
  "topPatterns": [
    { "rank": 1, "summary": "REST API error handling", "confidence": 0.850, "pageRank": 0.0456, "accessed": 12 }
  ],
  "delta": { "elapsed": "45m", "nodes": 2, "edges": 5 }
}
```

**Notes:**
- `density` is computed as `2 * edges / (nodes * (nodes - 1))`.
- `delta` compares the last two snapshots. `null` if fewer than 2 snapshots exist.
- `topPatterns` returns the top 10 entries from the ranked context.

---

### quoth_intelligence_feedback

Record success/failure feedback for the last-matched patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `success` | boolean | Yes | Whether the task succeeded |

**Returns:**
```json
{ "boosted": ["pat-abc", "pat-def"], "amount": 0.05 }
```

**Behavior:**
- Reads `last-matched.json` to identify which patterns/entries were most recently returned.
- Success: boosts confidence by `+0.05` and increments `accessCount`.
- Failure: reduces confidence by `-0.02` and increments `accessCount`.
- Updates both `ranked-context.json` and `graph-state.json`.

---

## MCP Tools: Agent Tools (6)

### quoth_daemon_status

Check if the Quoth learning daemon is running.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | - | - | - |

**Returns (running):**
```json
{ "running": true, "pid": 12345, "lastLog": "<last 3 log lines>" }
```

**Returns (stopped):**
```json
{ "running": false }
```

**Returns (stale PID):**
```json
{ "running": false, "stalePid": 12345 }
```

---

### quoth_ingest_trajectory

Ingest trajectory entries from any source (OpenClaw, external agents, batch import).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entries` | array | Yes | Array of trajectory entry objects |

**Entry object:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent` | string | Yes | - | Agent name |
| `task` | string | Yes | - | What the agent was doing |
| `outcome` | `'success'` \| `'failure'` | Yes | - | Task outcome |
| `event` | string | No | `'tool_use'` | Event type |
| `project` | string | No | `'unknown'` | Project namespace |
| `pattern_used` | string | No | `null` | Pattern applied (if any) |
| `source` | string | No | `'api'` | Source identifier |

**Returns:**
```json
{ "ingested": 5, "trajectoryFile": "/home/user/.quoth/trajectories/api-2026-04-04.jsonl", "daemonSignaled": true }
```

**Behavior:** Writes JSONL entries to `~/.quoth/trajectories/{source}-{date}.jsonl`. If the daemon is running, sends `SIGUSR1` to trigger immediate processing.

---

### quoth_agent_register

Register or update an agent in the Quoth coordination layer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Unique agent identifier |
| `name` | string | Yes | Human-readable name |
| `type` | `'claude-code'` \| `'openclaw'` \| `'daemon'` \| `'worker'` | Yes | Agent type |
| `project` | string | No | Project namespace |
| `platform` | string | No | Platform identifier |
| `capabilities` | string[] | No | Agent capabilities |
| `metadata` | object | No | Additional metadata |

**Returns:**
```json
{ "registered": true, "agentId": "deployer-montino" }
```

**Side effects:** Emits an `agent.registered` event to the local event system.

---

### quoth_agent_heartbeat

Send heartbeat to keep agent status as online.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent identifier |
| `status` | `'online'` \| `'busy'` \| `'idle'` | No | Current status |

**Returns:**
```json
{ "ok": true, "agentId": "deployer-montino", "timestamp": 1712188800000 }
```

---

### quoth_agent_list

List registered agents with optional filtering.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | - | Filter by project |
| `type` | string | No | - | Filter by agent type |
| `status` | `'online'` \| `'offline'` \| `'busy'` \| `'idle'` | No | - | Filter by status |
| `limit` | number | No | 20 | Maximum agents to return |

**Returns:**
```json
{
  "count": 3,
  "agents": [
    { "agent_id": "deployer-montino", "name": "Deployer", "type": "openclaw", "status": "online", ... }
  ]
}
```

---

### quoth_assign_task

Assign a task to an agent via the local event system.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agentId` | string | Yes | - | Target agent ID |
| `task` | string | Yes | - | Task description |
| `priority` | `'low'` \| `'medium'` \| `'high'` \| `'critical'` | No | `'medium'` | Task priority |
| `metadata` | object | No | - | Additional task metadata |

**Returns:**
```json
{ "assigned": true, "eventId": 42, "agentId": "deployer-montino", "task": "Deploy v3.2.0 to production" }
```

---

## MCP Tools: Skill Tools (2)

### quoth_extract_skill

Extract a reusable test skill from a passing test file using Sonnet 4.6.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testFile` | string | Yes | Path to the passing test file |
| `feature` | string | No | Feature name for context (defaults to test filename) |

**Returns:**
```json
{
  "extracted": true,
  "skill": {
    "name": "API validation error handling",
    "description": "Pattern for validating...",
    "template": "...",
    "assertions": ["status-code", "error-body"],
    "pageObjects": ["api-handler"]
  }
}
```

**Behavior:** Calls `daemon/lib/skill-extract.js` to analyze the test file, then upserts the skill into the patterns database with:
- `id`: `skill-{sha1(name).slice(0,12)}`
- `pattern_type`: `'skill'`
- `confidence`: `0.85` (fixed initial value)
- `source`: `'skill-derived'`

---

### quoth_list_skills

List all extracted skills from the local pattern database.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tags` | string[] | No | Filter by tags |

**Returns:**
```json
{
  "skills": [
    { "id": "skill-a1b2c3", "name": "...", "source": "skill-derived", "pattern_type": "skill", ... }
  ]
}
```

**Behavior:** Fetches top 50 patterns and filters to those with `source === 'skill-derived'` or `pattern_type === 'skill'`.

---

## REST API Endpoints (SaaS)

The SaaS platform is a Next.js App Router application deployed on Vercel. All API routes use the `createApiHandler` wrapper (`src/lib/api/handler.ts`) which provides:

1. **Request timeout** -- configurable, default 30 seconds
2. **Authentication** -- Clerk JWT or agent API key (`qth_*` prefix)
3. **Rate limiting** -- Upstash Redis sliding window (configurable RPM)
4. **Input validation** -- Zod schemas for body and query params
5. **Error handling** -- RFC 7807 problem detail responses

**Auth modes:**
- `'required'` -- 401 if no auth (Clerk or agent key)
- `'optional'` -- null context allowed
- `'none'` -- no auth check (e.g., health endpoint)

### Base URL

Production: `https://quoth.triqual.dev`

---

### Versioned API (`/api/v1/`)

#### Health

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `GET` | `/api/v1/health` | none | - | Health check with DB connectivity test |

**Response (200):**
```json
{
  "status": "healthy",
  "version": "v1",
  "timestamp": "2026-04-04T12:00:00.000Z",
  "checks": { "database": { "ok": true, "latencyMs": 12 } }
}
```

**Response (503):** Same structure with `"status": "degraded"` and `"ok": false`.

---

#### Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/projects` | required | List projects for the authenticated org |
| `POST` | `/api/v1/projects` | required | Create a new project |
| `GET` | `/api/v1/projects/[id]` | required | Get project by ID |
| `PATCH` | `/api/v1/projects/[id]` | required | Update project |
| `DELETE` | `/api/v1/projects/[id]` | required | Delete project |

---

#### Agents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/agents` | required | List agents in the org |
| `POST` | `/api/v1/agents` | required | Register a new agent |
| `GET` | `/api/v1/agents/[id]` | required | Get agent by ID |
| `PATCH` | `/api/v1/agents/[id]` | required | Update agent |
| `DELETE` | `/api/v1/agents/[id]` | required | Remove agent |
| `POST` | `/api/v1/agents/[id]/keys` | required | Generate a new API key |
| `GET` | `/api/v1/agents/[id]/keys` | required | List API keys for an agent |

---

#### Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/documents` | required | List documents |
| `POST` | `/api/v1/documents` | required | Create or update a document |

---

#### Search

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/api/v1/search` | required | 60 RPM | Hybrid search (vector + FTS + optional reranking) |

**Request body:**
```json
{
  "query": "error handling patterns",
  "limit": 10,
  "threshold": 0.5,
  "rerank": true,
  "hybridWeight": 0.7,
  "scope": "project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string (1-2000 chars) | Yes | Search query |
| `limit` | integer (1-50) | No | Max results |
| `threshold` | number (0-1) | No | Minimum similarity threshold |
| `rerank` | boolean | No | Enable Jina reranking |
| `hybridWeight` | number (0-1) | No | Weight between vector (1.0) and FTS (0.0) |
| `scope` | `'project'` \| `'shared'` \| `'all'` | No | Search scope |

---

#### Memory

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/memory` | required | List memory entries |
| `POST` | `/api/v1/memory` | required | Store a memory entry |
| `GET` | `/api/v1/memory/[key]` | required | Get memory entry by key |
| `DELETE` | `/api/v1/memory/[key]` | required | Forget (delete) a memory entry |
| `POST` | `/api/v1/memory/search` | required | Semantic memory search |

---

#### Patterns

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/api/v1/patterns/promote` | required (agent key only) | 30 RPM | Receive promoted pattern from daemon |

**Request body:**
```json
{
  "patternId": "abc123",
  "name": "REST API error handling",
  "condition": "When building error responses...",
  "action": "Use RFC 7807 problem detail format...",
  "content": "Full pattern content...",
  "confidence": 0.92,
  "successCount": 15,
  "failureCount": 2,
  "tags": ["api", "error-handling"],
  "applicability": "broad",
  "embedding": [0.123, ...],
  "projectSlug": "quoth"
}
```

**Notes:**
- Agent API keys only -- Clerk JWT results in 403.
- Minimum confidence: `0.8`.
- Embedding must be `voyage-4-lite` 1024-dimensional vectors (same model as cloud index).
- Creates or updates a document at `system/patterns/{patternId}` with a chunk containing the embedding.
- Tracks version history in `document_history` table.

---

#### Trajectories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/trajectories/ingest` | required | Receive trajectory data from external agents |

---

#### Communications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/comms/channels` | required | List channels |
| `POST` | `/api/v1/comms/channels` | required | Create a channel |
| `POST` | `/api/v1/comms/channels/[id]/subscribe` | required | Subscribe agent to channel |
| `GET` | `/api/v1/comms/messages` | required | List messages (inbox or channel) |
| `POST` | `/api/v1/comms/messages` | required | Send a message |
| `GET` | `/api/v1/comms/messages/[id]/thread` | required | Get message thread |
| `GET` | `/api/v1/comms/tasks` | required | List tasks |
| `POST` | `/api/v1/comms/tasks` | required | Create a task |

---

#### Generations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/generations/[id]` | required | Get generation status (streaming, complete, failed) |

---

#### Profile and Onboarding

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/profile` | required | Get authenticated user profile |
| `POST` | `/api/v1/onboarding` | required | Complete onboarding flow |

---

#### Daemon Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/daemon/agents` | required | List daemon-registered agents |
| `POST` | `/api/v1/daemon/events` | required | Emit event to daemon |

---

#### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/admin/setup-schedules` | required | Initialize cron job schedules |

---

#### Cron Jobs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/cron/cleanup-cache` | required | Clean expired cache entries |
| `POST` | `/api/v1/cron/consolidate` | required | Run cloud-side pattern consolidation |
| `POST` | `/api/v1/cron/webhook-retry` | required | Retry failed webhook deliveries |

---

### Internal API Routes (non-versioned)

These routes power the web dashboard and are not part of the public API contract.

#### Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/analytics/miss-rate` | required | Search miss rate over time |
| `GET` | `/api/analytics/usage` | required | Usage analytics (queries, patterns, agents) |

---

#### Knowledge Base

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/knowledge-base/[id]` | required | Get knowledge base entry |
| `PATCH` | `/api/knowledge-base/[id]` | required | Update entry |
| `DELETE` | `/api/knowledge-base/[id]` | required | Delete entry |
| `POST` | `/api/knowledge-base/[id]/rollback` | required | Rollback to previous version |
| `POST` | `/api/knowledge-base/ask` | required | RAG question answering |

---

#### Project Management (Internal)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/projects/[projectId]/activity` | required | Activity log |
| `GET` | `/api/projects/[projectId]/agents` | required | Project agents |
| `GET` | `/api/projects/[projectId]/coverage` | required | Pattern coverage stats |
| `GET` | `/api/projects/[projectId]/drift` | required | Knowledge drift events |
| `GET` | `/api/projects/[projectId]/health` | required | Project health dashboard |
| `GET` | `/api/projects/[projectId]/team` | required | List team members |
| `POST` | `/api/projects/[projectId]/team` | required | Add team member |
| `DELETE` | `/api/projects/[projectId]/team/[memberId]` | required | Remove team member |
| `GET` | `/api/projects/[projectId]/invitations` | required | List pending invitations |
| `POST` | `/api/projects/[projectId]/invitations` | required | Send invitation |
| `DELETE` | `/api/projects/[projectId]/invitations/[id]` | required | Cancel invitation |
| `GET` | `/api/projects/by-slug/[slug]` | required | Lookup project by slug |

---

#### Proposals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/proposals` | required | List proposals |
| `POST` | `/api/proposals` | required | Create proposal |
| `GET` | `/api/proposals/[id]` | required | Get proposal |
| `POST` | `/api/proposals/[id]/approve` | required | Approve proposal |
| `POST` | `/api/proposals/[id]/reject` | required | Reject proposal |

---

#### MCP and OAuth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/[transport]` | varies | MCP transport endpoint (SSE/streamable HTTP) |
| `POST` | `/api/mcp/public` | none | Public MCP endpoint |
| `POST` | `/api/mcp-token/generate` | required | Generate MCP access token |
| `GET` | `/api/mcp-token/list` | required | List MCP tokens |
| `GET` | `/api/oauth/authorize` | none | OAuth 2.0 authorization endpoint |
| `POST` | `/api/oauth/token` | none | OAuth 2.0 token exchange |
| `POST` | `/api/oauth/register` | none | Dynamic client registration (RFC 7591) |

---

#### Invitations and Webhooks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/invitations/accept` | required | Accept a team invitation |
| `POST` | `/api/webhooks/clerk` | webhook | Clerk user/org lifecycle events |

---

#### OpenAPI

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/openapi.json` | none | OpenAPI 3.0 specification |
