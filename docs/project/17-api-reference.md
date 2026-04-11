# API Reference

**Version:** 1.0.5 | **Last updated:** 2026-04-11

API reference index for the Quoth system.

---

## MCP Tools (22)

For complete MCP tool documentation (22 tools across 4 handlers — Patterns, Intelligence, Agents, Skills), including protocol details, parameter tables, return schemas, and behavior notes, see [06 — MCP Server & Tools](./06-mcp-tools.md).

---

## REST API Endpoints

The Quoth SaaS backend exposes REST endpoints on Vercel for managed-mode clients. These are consumed by the daemon when `QUOTH_MODE=managed`.

### POST /api/v1/pipeline/process

Process trajectory entries through the cloud JUDGE -> DISTILL -> CONSOLIDATE pipeline.

**Authentication:** `Authorization: Bearer <QUOTH_API_KEY>` (qth_* key)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entries` | object[] | Yes | Array of JSONL trajectory entries |
| `projectId` | string | No | Project namespace for scoping |

**Response:**
```json
{
  "processed": 5,
  "patterns": 2,
  "status": "ok"
}
```

**Error responses:**
- `401` — Missing or invalid API key
- `422` — Malformed entries array
- `500` — Pipeline processing failure

---

### POST /api/v1/patterns/promote

Promote a local pattern to the Quoth cloud index.

**Authentication:** `Authorization: Bearer <QUOTH_API_KEY>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `patternId` | string | Yes | Pattern identifier (12-char SHA-1 hash) |
| `name` | string | Yes | Pattern name |
| `condition` | string | Yes | When this pattern applies |
| `action` | string | Yes | What to do when the pattern matches |
| `content` | string | Yes | Formatted markdown content block for the cloud document |
| `confidence` | number | Yes | Bayesian confidence score (0.0–1.0) |
| `successCount` | integer | Yes | Total recorded successes |
| `failureCount` | integer | Yes | Total recorded failures |
| `tags` | string[] | Yes | Tag array (e.g., `["agent:coder"]`) |
| `applicability` | string | Yes | `'narrow'` or `'broad'` |
| `projectSlug` | string | No | Originating project namespace (omitted for `default` namespace) |
| `embedding` | number[] | No | 384-dim MiniLM-L6-v2 embedding vector |

**Response:**
```json
{
  "promoted": true,
  "documentId": "...",
  "version": 1,
  "status": "published"
}
```

---

## Cron Jobs

### Nightly Pattern Promotion (3:00 AM local)

The daemon runs a nightly cycle that promotes high-confidence patterns to the Quoth cloud:

- **Criteria:** confidence > 0.8, use count > 10, not already promoted
- **Implementation:** `daemon/lib/promote.js`
- **Endpoint:** `POST /api/v1/patterns/promote`
- **Requires:** `QUOTH_API_KEY` set in `~/.quoth/.env`
