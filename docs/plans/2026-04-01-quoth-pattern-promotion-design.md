# Quoth Pattern Promotion — Design Document

**Date:** 2026-04-01
**Status:** Approved
**Scope:** quoth-plugin daemon → Quoth cloud API → shared pattern library

---

## Goal

Close the local→cloud loop in the Quoth self-learning system. Patterns that accumulate confidence in the local SQLite daemon should automatically promote to the Quoth cloud (`quoth.triqual.dev`) nightly, becoming searchable by all projects in the org via `quoth_search_index`.

## Architecture

### Full Flow

```
Session
  ↓
subagent-stop.sh → ~/.quoth/trajectories/{session}.jsonl

Daemon (background)
  ↓
JUDGE → DISTILL (+ embedding) → CONSOLIDATE (cosine similarity)
  ↓
local SQLite (~/.quoth/memory.db)
  ↓ confidence scoring, hourly decay
  ↓
3am: Sonnet deep consolidation (dedup + archive weak)
  ↓
getPromotionCandidates()
  confidence > 0.8 AND (success + failure) > 10 AND source = 'distilled'
  ↓
POST /api/v1/patterns/promote   ← NEW
  Auth: Bearer qth_...
  ↓
docs.documents (docType: 'patterns')
  + documentHistory (version trail)
  + docs.chunks (HNSW indexed)
  ↓
quoth_search_index returns to all projects in org
```

### Visibility Tiers

| Pattern Type | `applicability` | Cloud Visibility | Who Sees It |
|---|---|---|---|
| General (auth patterns, commit conventions) | `'broad'` | `visibility: 'shared'`, `projectId: null` | All projects in org |
| Project-specific (Playwright selectors, UI patterns) | `'narrow'` | `visibility: 'project'`, `projectId: current` | Only that project |

The `applicability` field is already set by the DISTILL step — no new inference needed.

### Re-promotion Logic

A pattern is re-promoted only when `confidence - promoted_confidence > 0.1`. This prevents noisy re-submissions while still tracking meaningful improvement over time. Every promotion writes the previous version to `documentHistory` — full evolution trail preserved.

---

## Server-Side Changes

### New Endpoint: `POST /api/v1/patterns/promote`

**File:** `src/app/api/v1/patterns/promote/route.ts`

**Auth:** Agent API key (`qth_*`) required. Clerk JWT rejected (daemon-only route).

**Rate limit:** 30 rpm per key.

**Request body (Zod-validated):**
```typescript
{
  patternId: string,           // sha1 hash (local SQLite id)
  name: string,                // max 100 chars
  condition: string,           // when to apply this pattern
  action: string,              // what to do (the pattern text)
  confidence: number,          // must be >= 0.8
  successCount: number,
  failureCount: number,
  tags: string[],
  embedding?: number[],        // 3072-dim float array (text-embedding-3-large)
  applicability: 'broad' | 'narrow',
  projectId?: string           // required when applicability = 'narrow'
}
```

**Response:**
```typescript
{
  documentId: string,
  version: number,
  status: 'created' | 'updated' | 'skipped',
  filePath: string
}
```

**Endpoint logic:**
1. Verify agent API key → resolve `orgId`, `agentId`
2. Validate confidence >= 0.8 (server-side guard)
3. Derive `filePath = "system/patterns/{patternId}"`
4. Derive `visibility` and `projectId` from `applicability`
5. Check for existing doc by `(orgId, filePath)`
6. If exists: write current to `documentHistory` (changeType: `'update'`), bump version
7. Build markdown content from pattern fields
8. If embedding provided: use as-is. If missing: generate server-side from `action` text
9. Upsert `docs.documents`, chunk + index into `docs.chunks` (HNSW)
10. Return `{ documentId, version, status }`

**Document content format:**
```markdown
# {name}

**Condition:** {condition}

**Action:** {action}

**Confidence:** {confidence} ({successCount} successes, {failureCount} failures)

**Tags:** {tags}

**Source:** Distilled from local learning daemon — promoted {date}
```

**Metadata stored** (JSON column on `docs.documents`):
```json
{
  "confidence": 0.87,
  "successCount": 14,
  "failureCount": 2,
  "promotedFrom": "quoth-plugin-daemon",
  "lastPromotedAt": "2026-04-01T03:00:00Z",
  "version": 3
}
```

### No Schema Migration Required

- `docs.documents.metadata` is already a free-form JSON column
- `docType: 'patterns'` already in the enum
- `visibility: 'shared'` already supported
- `documentHistory` already tracks versioning

---

## Daemon-Side Changes

### SQLite Schema Addition (`daemon/db.js`)

```sql
ALTER TABLE patterns ADD COLUMN promoted_at INTEGER;
ALTER TABLE patterns ADD COLUMN cloud_document_id TEXT;
ALTER TABLE patterns ADD COLUMN promoted_confidence REAL;
ALTER TABLE patterns ADD COLUMN applicability TEXT DEFAULT 'narrow';
```

New db methods:
- `db.markPromoted(id, cloudDocumentId, confidence)` — sets promoted_at, cloud_document_id, promoted_confidence
- `db.getPromotionCandidates()` — updated to return applicability field

### New File: `daemon/lib/promote.js`

```javascript
async function promotePattern(pattern) {
  // Returns null if QUOTH_API_KEY not set (graceful no-op)
  // POSTs to /api/v1/patterns/promote
  // Returns { documentId, version, status } or null on failure
}
```

Environment variables:
```bash
QUOTH_API_KEY=qth_...                    # generated from Quoth dashboard
QUOTH_PROJECT_ID=uuid                    # per-repo project ID
QUOTH_API_URL=https://quoth.triqual.dev  # optional override
```

### `runDeepConsolidate` Extension (`daemon/daemon.js`)

After Sonnet cleanup (merges + archives), add promotion phase:
```javascript
const candidates = db.getPromotionCandidates()
for (const pattern of candidates) {
  const needsRepromotion = !pattern.promoted_at ||
    (pattern.confidence - (pattern.promoted_confidence || 0)) > 0.1
  if (!needsRepromotion) continue

  const result = await promotePattern(pattern)
  if (result) {
    db.markPromoted(pattern.id, result.documentId, pattern.confidence)
    log('info', 'Pattern promoted to cloud', { id: pattern.id, version: result.version, status: result.status })
  }
}
```

### New MCP Tool: `quoth_propose_update`

Added to `mcp/quoth-learning-server.js` — allows agents to manually trigger promotion of a specific pattern without waiting for 3am:

```javascript
{
  name: 'quoth_propose_update',
  description: 'Manually promote a high-confidence local pattern to the Quoth cloud index',
  inputSchema: {
    type: 'object',
    properties: {
      patternId: { type: 'string', description: 'Local pattern ID to promote' }
    },
    required: ['patternId']
  }
}
// → calls promotePattern(db.getPattern(patternId))
// → returns { documentId, version, status } or { error }
```

---

## Error Handling

All promotion is fire-and-forget. Failures never affect local scoring or the nightly cycle.

| Scenario | Behavior |
|---|---|
| `QUOTH_API_KEY` not set | Skip all promotion, log debug |
| Network unreachable | Log warning, retry next night |
| 401 Unauthorized | Log error with hint, skip cycle |
| 429 Rate limited | Exponential backoff, max 3 retries |
| 500 Server error | Skip pattern, retry next night |
| Confidence delta < 0.1 | Skip (already at latest version) |
| Embedding missing | Server generates from `action` text |
| Partial batch failure | Succeeded patterns marked, failed retry next night |

**Local SQLite is always source of truth.** Cloud is additive-only. If cloud is unreachable for days, patterns keep accumulating locally and catch up automatically.

---

## Testing Plan

### Server-Side

- Unit: Zod validation — rejects confidence < 0.8, wrong embedding dimensions, missing projectId when narrow
- Unit: Upsert logic — new doc vs update + `documentHistory` write
- Unit: Visibility derivation — broad → shared + null projectId, narrow → project + projectId
- Integration: Agent key accepted, Clerk JWT rejected
- Integration: Embedding generated server-side when not provided

### Daemon-Side

- Unit: `promote.js` — mock fetch, verify headers + body shape
- Unit: Re-promotion gate — skips when delta < 0.1, runs when delta >= 0.1
- Unit: `db.markPromoted` — verifies all three columns written correctly
- Unit: `runDeepConsolidate` — promotion runs after Sonnet cleanup, not before
- Unit: `quoth_propose_update` MCP tool — calls promotePattern, returns result
- Unit: Graceful no-op when QUOTH_API_KEY not set
- Integration: Full nightly cycle with in-memory SQLite + mocked fetch

---

## Setup (One-Time Per Repo)

```bash
# 1. Generate API key from Quoth dashboard or CLI
# Results in: qth_xxxxxxxxxxxxx...

# 2. Add to repo .env.local (or shell profile for daemon)
QUOTH_API_KEY=qth_...
QUOTH_PROJECT_ID=<uuid-from-quoth-project-settings>
# QUOTH_API_URL=https://quoth.triqual.dev  # default, only set to override

# 3. Daemon picks up on next start (session-start.sh auto-starts it)
```

---

## Files Changed

### Server (`/Users/agustinmontoya/Attorneyshare/Quoth/`)
| Action | Path |
|---|---|
| Create | `src/app/api/v1/patterns/promote/route.ts` |

### Daemon (`/Users/agustinmontoya/Attorneyshare/Quoth/quoth-plugin/`)
| Action | Path |
|---|---|
| Create | `daemon/lib/promote.js` |
| Modify | `daemon/db.js` — add 4 columns + markPromoted + getPromotionCandidates returns applicability |
| Modify | `daemon/daemon.js` — wire promotion into runDeepConsolidate |
| Modify | `mcp/quoth-learning-server.js` — add quoth_propose_update tool |
| Create | `tests/promote.test.js` |
| Modify | `tests/db.test.js` — add markPromoted + re-promotion gate tests |
| Modify | `tests/integration.test.js` — add quoth_propose_update test |
