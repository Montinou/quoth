# API Reference

**Version:** 1.0.1 | **Last updated:** 2026-04-06

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
json
{
  "logged": true,
  "patternId": "abc123",
  "result": "success",
  "confidence": 0.72
}
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

Import Exolar clustered failures as pattern candidates. Spawns a Haiku subagent to query Exolar and write JSONL trajectory entries that the daemon will process.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `dataset` | string | No | `'clustered_failures'` | Exolar dataset to import from |
| `projectId` | string | No | - | Limit import to a specific Exolar project |

**Returns:**
```json
{ "seeded": true, "trajectoryFile": "~/.quoth/trajectories/exolar-seed-<ts>.jsonl" }
```

**Error conditions:**
- Subagent spawn failure: `{ "seeded": false, "error": "<message>" }`

**Behavior:** Spawns `claude-haiku-4-5-20251001` via `spawnSync` to query the `mcp__plugin_triqual-plugin_exolar-qa__query_exolar_data` tool and write one JSONL line per cluster to the trajectories directory. The daemon picks up the file and processes it through the normal JUDGE → DISTILL → CONSOLIDATE pipeline.

---

### quoth_propose_update

Manually promote a high-confidence local pattern to the Quoth cloud index without waiting for the nightly cycle.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patternId` | string | Yes | Local pattern ID to promote |

**Returns:**
```json
{
  "promoted": true,
  "documentId": "...",
  "version": 1,
  "status": "published"
}
```

**Error conditions:**
- Pattern not found: `{ "error": "Pattern 'X' not found in local DB" }`
- Promotion failed: `{ "error": "Promotion failed — check QUOTH_API_KEY and daemon logs" }`

**Behavior:** Calls `daemon/lib/promote.js` directly (same logic as the nightly sync) and marks the pattern as promoted in the local DB via `db.markPromoted()`.

---

## MCP Tools: Intelligence Tools (6)

### quoth_route_task

Route a task description to the optimal agent type using keyword matching and learned patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task description to route |

**Returns:**
```json
{
  "agent": "coder",
  "confidence": 0.8,
  "reason": "Matched pattern: implement|create|build",
  "alternatives": [
    { "agent": "tester", "confidence": 0.6, "reason": "..." }
  ]
}
```

---

### quoth_intelligence_init

Initialize the intelligence graph from memory entries and patterns. Call at session start.

No parameters.

**Returns:**
```json
{ "initialized": true, "nodes": 42, "edges": 87 }
```

---

### quoth_intelligence_context

Get ranked context entries relevant to a prompt using trigram matching and PageRank scores.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The prompt to find context for |
| `topK` | number | No | 5 | Maximum context entries to return |

**Returns:**
```json
{
  "context": [
    { "key": "...", "content": "...", "score": 0.91 }
  ]
}
```

---

### quoth_intelligence_consolidate

Process pending edits, rebuild graph edges, and recompute PageRank. Call at session end or before context compression.

No parameters.

**Returns:**
```json
{ "consolidated": true, "patternsRefreshed": 50, "edgesRebuilt": 120 }
```

---

### quoth_intelligence_stats

Get intelligence diagnostics: graph health, confidence distribution, PageRank scores, and trends.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `json` | boolean | No | `true` | Return structured JSON (vs. human-readable text) |

**Returns:**
```json
{
  "graph": { "nodes": 42, "edges": 87 },
  "confidence": { "mean": 0.62, "high": 12, "low": 5 },
  "topPatterns": [...]
}
```

---

### quoth_intelligence_feedback

Record success/failure feedback for the last-matched patterns (read from `~/.quoth/intelligence/last-matched.json`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `success` | boolean | Yes | Whether the task that used the matched patterns succeeded |

**Returns:**
```json
{ "updated": 3, "patternIds": ["pat-abc", "pat-def", "pat-ghi"] }
```

---

## MCP Tools: Agent Tools (6)

### quoth_daemon_status

Check if the Quoth learning daemon is running.

No parameters.

**Returns (running):**
```json
{ "running": true, "pid": 12345, "lastLog": "...(last 3 log lines)..." }
```

**Returns (not running):**
```json
{ "running": false }
```

**Returns (stale PID):**
```json
{ "running": false, "stalePid": 12345 }
```

---

### quoth_ingest_trajectory

Ingest trajectory entries from any source (OpenClaw agents, external systems, batch import).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entries` | object[] | Yes | Array of trajectory entry objects |

**Entry object:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent` | string | Yes | - | Agent name |
| `task` | string | Yes | - | What the agent was doing |
| `outcome` | `'success'` \| `'failure'` | Yes | - | Outcome |
| `event` | string | No | `'tool_use'` | Event type |
| `project` | string | No | - | Project namespace |
| `pattern_used` | string | No | - | Pattern applied (if any) |
| `source` | string | No | `'api'` | Source identifier |

**Returns:**
```json
{
  "ingested": 5,
  "trajectoryFile": "~/.quoth/trajectories/api-2026-04-06.jsonl",
  "daemonSignaled": true
}
```

**Behavior:** Appends entries as JSONL to the trajectories directory, then sends `SIGUSR1` to the daemon (if running) to trigger immediate processing.

---

### quoth_agent_register

Register or update an agent in the Quoth coordination layer. Emits an `agent.registered` event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Unique agent identifier |
| `name` | string | Yes | Human-readable name |
| `type` | `'claude-code'` \| `'openclaw'` \| `'daemon'` \| `'worker'` | Yes | Agent type |
| `project` | string | No | Project namespace |
| `platform` | string | No | Platform identifier |
| `capabilities` | string[] | No | List of capability tags |
| `metadata` | object | No | Arbitrary metadata |

**Returns:**
```json
{ "registered": true, "agentId": "agent-abc" }
```

---

### quoth_agent_heartbeat

Send a heartbeat to keep an agent's status as online.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID |
| `status` | `'online'` \| `'busy'` \| `'idle'` | No | Current status |

**Returns:**
```json
{ "ok": true, "agentId": "agent-abc", "timestamp": 1712345678901 }
```

---

### quoth_agent_list

List registered agents, optionally filtered by project, type, or status.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | No | - | Filter by project namespace |
| `type` | string | No | - | Filter by agent type |
| `status` | `'online'` \| `'offline'` \| `'busy'` \| `'idle'` | No | - | Filter by status |
| `limit` | number | No | 20 | Maximum agents to return |

**Returns:**
```json
{ "count": 3, "agents": [...] }
```

---

### quoth_assign_task

Assign a task to an agent via the event system.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agentId` | string | Yes | - | Target agent ID |
| `task` | string | Yes | - | Task description |
| `priority` | `'low'` \| `'medium'` \| `'high'` \| `'critical'` | No | `'medium'` | Task priority |
| `metadata` | object | No | - | Arbitrary task metadata |

**Returns:**
```json
{
  "assigned": true,
  "eventId": 42,
  "agentId": "agent-abc",
  "task": "Analyze deployment logs"
}
```

---

## MCP Tools: Skill Tools (2)

### quoth_extract_skill

Extract a reusable test skill from a passing test file using Claude Sonnet 4.6. The extracted skill is stored as a `skill-derived` pattern in the local DB with a confidence of 0.85.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testFile` | string | Yes | Path to the passing test file |
| `feature` | string | No | Feature name for context (defaults to filename without extension) |

**Returns:**
```json
{
  "extracted": true,
  "skill": {
    "name": "...",
    "description": "...",
    "template": "...",
    "assertions": [...],
    "pageObjects": [...]
  }
}
```

**Error conditions:**
- `{ "error": "Skill extraction failed — check test file exists and is readable" }`

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
    { "id": "skill-abc123", "name": "...", "condition": "...", "action": "...", "confidence": 0.85, ... }
  ]
}
```

**Behavior:** Returns patterns where `source === 'skill-derived'` or `pattern_type === 'skill'` from the top 50 patterns by confidence.
