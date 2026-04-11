# Cloud Sync & Promotion

*Version: 1.0.4 — Last updated: 2026-04-11*

Documentation of the pattern promotion and cloud synchronization system that bridges the local SQLite-based learning daemon with the Quoth cloud platform (quoth.triqual.dev).

## Overview

High-confidence local patterns are promoted to the Quoth cloud platform for:
- **Cross-team sharing**: Patterns learned by one instance become available to all instances in the same organization
- **Persistent storage**: Cloud patterns survive local resets or machine migrations
- **Cross-project discovery**: Via semantic search across all promoted patterns

There are two independent promotion systems:
1. **Cloud promotion**: Local patterns -> Quoth SaaS (quoth.triqual.dev) via REST API
2. **Global namespace promotion**: Project-scoped patterns -> local `global` namespace (no API calls)

## Cloud Promotion

### Eligibility Criteria

Patterns eligible for cloud promotion must meet ALL of the following criteria (enforced by `db.getPromotionCandidates()`):

| Criterion | Threshold | Column |
|-----------|-----------|--------|
| Confidence score | > 0.8 | `patterns.confidence` |
| Total uses | > 10 | `success_count + failure_count` |
| Status | `active` | `patterns.status` |
| Source | `distilled` | `patterns.source` |

sql
SELECT * FROM patterns
WHERE confidence > 0.8
  AND (success_count + failure_count) > 10
  AND status = 'active'
  AND source = 'distilled'
### Nightly Promotion (3am Daily)

The daemon schedules deep consolidation at 06:00 UTC (03:00 ART) via `scheduleNightlyPipeline()`. This is a multi-phase process:

**Phase 1: LLM-Powered Deduplication**
1. Fetches top 20 patterns by confidence
2. Sends them to an LLM (via `daemon/lib/llm.js`) asking for merge/archive recommendations
3. Applies merges (Bayesian success update on keep target, archive the duplicate)
4. Archives low-value patterns

LLM calls route through the **Vercel AI Gateway** (`ai-gateway.vercel.sh`) using `google/gemini-2.5-flash-lite` by default (fast, cheap, JSON mode). Override via `QUOTH_LLM_MODEL` env var. Moonshot (Kimi K2.5 direct) is a legacy fallback used only when `MOONSHOT_API_KEY` is set but `AI_GATEWAY_API_KEY` is not.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_GATEWAY_API_KEY` | Yes (primary) | (none) | Vercel AI Gateway key (`vck_*`) |
| `QUOTH_LLM_MODEL` | No | `google/gemini-2.5-flash-lite` | Override LLM model (any gateway-supported model) |
| `MOONSHOT_API_KEY` | No | (none) | Legacy fallback — Kimi K2.5 direct (only used if no gateway key) |

**Phase 2: Cloud Promotion**
1. Calls `db.getPromotionCandidates()` to get eligible patterns
2. For each candidate, checks if promotion is needed:
   - Never promoted before (`promoted_at IS NULL`)
   - OR confidence improved by > 0.1 since last promotion (`confidence - promoted_confidence > 0.1`)
3. Calls `promotePattern(pattern)` from `daemon/lib/promote.js`
4. On success: marks pattern via `db.markPromoted(id, cloudDocumentId, confidence)`
5. Emits `pattern.promoted` event to the local event system

**Phase 3: Global Namespace Promotion**
1. Queries patterns with: `confidence > 0.8`, `uses > 10`, `applicability = 'broad'`, `namespace != 'global'`
2. Promotes each to `global` namespace via `db.promoteToGlobal(id)`
3. Global patterns become accessible to all projects via `getProjectPatterns()`

### On-Demand Promotion (MCP Tool)

The `quoth_propose_update(patternId)` MCP tool triggers immediate promotion without waiting for the nightly cycle. This is useful when a user explicitly wants to share a pattern.

## Promotion API Flow (promote.js)

Source: `quoth-plugin/daemon/lib/promote.js`

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOTH_API_KEY` | Yes | (none) | API key with `qth_` prefix |
| `QUOTH_API_URL` | No | `https://quoth.triqual.dev` | Cloud API base URL |

If `QUOTH_API_KEY` is not set, `promotePattern()` returns `null` silently -- cloud sync is completely optional.

### Project Auto-Creation (ensureProject)

Before promoting a pattern, the system ensures the pattern's project namespace exists in the cloud:

1. **Cache check**: `knownProjects` in-memory Set avoids repeated lookups
2. **List existing**: `GET /api/v1/projects?limit=100` with Bearer auth
3. **Cache all slugs**: Populates the Set from the response for future lookups
4. **Create if missing**: `POST /api/v1/projects` with auto-generated name

```javascript
{
  slug: "quoth",
  name: "Quoth",  // Auto-capitalized from slug
  description: "Auto-created from local daemon pattern promotion"
}
```

### Promotion Request

`POST /api/v1/patterns/promote` with Bearer token authentication.

Request body:

```json
{
  "patternId": "abc123-local-pattern-id",
  "name": "Pattern name (max 60 chars)",
  "condition": "When this pattern applies",
  "action": "What action to take",
  "content": "Markdown-formatted pattern details (see Content Format below)",
  "confidence": 0.85,
  "successCount": 15,
  "failureCount": 2,
  "tags": ["tag1", "tag2"],
  "applicability": "narrow",
  "projectSlug": "quoth",
  "embedding": [0.1, 0.2, ...]
}
```

Notes:
- `projectSlug` is omitted (undefined) if the pattern namespace is `'default'`
- `embedding` is included only if the pattern has one stored locally; parsed from JSON string if needed
- `applicability` defaults to `'narrow'` if not set on the pattern

### Content Format

The `buildContent(pattern)` function generates markdown for the `content` field:

```markdown
# Pattern Name

**Condition:** When this pattern applies

**Action:** What action to take

**Confidence:** 0.85 (15 successes, 2 failures)

**Tags:** tag1, tag2

**Source:** Distilled from local learning daemon — promoted 2026-04-04
```

Tags are parsed from JSON if stored as a string. The date is the current date at promotion time.

### API Call Implementation

All HTTP requests use Node.js native `https` module (no dependencies):
- 15-second timeout per request
- Errors are silently caught and return `null` (promotion is non-critical)
- Content-Type: `application/json`
- Authorization: `Bearer <QUOTH_API_KEY>`

### Post-Promotion Tracking

After successful promotion, the local database records:

```sql
UPDATE patterns SET
  promoted_at = <current_timestamp>,
  cloud_document_id = '<returned_document_id>',
  promoted_confidence = <confidence_at_promotion_time>
WHERE id = ?
```

This enables:
- Skipping already-promoted patterns that haven't improved
- Re-promoting patterns whose confidence increased by > 0.1

## Global Namespace Promotion

Separate from cloud promotion. During deep consolidation, patterns that meet broad applicability criteria are promoted to the local `global` namespace so they are accessible to all projects.

### Eligibility Criteria

| Criterion | Threshold |
|-----------|-----------|
| Confidence | > 0.8 |
| Total uses | > 10 |
| Applicability | `broad` |
| Namespace | not already `global` |

### Mechanism

1. Queries eligible patterns via `db` (confidence, uses, applicability, namespace filters)
2. Calls `db.promoteToGlobal(id)` for each candidate — updates `namespace = 'global'`
3. Global patterns are then returned by `getProjectPatterns()` for any project

No API calls are made. This is a local-only operation that runs during the nightly 3am deep consolidation cycle, or on-demand via `quoth_intelligence_consolidate`.

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOTH_API_KEY` | Cloud sync only | (none) | API key (`qth_*`) for cloud promotion |
| `QUOTH_API_URL` | No | `https://quoth.triqual.dev` | Cloud API base URL |
| `AI_GATEWAY_API_KEY` | Yes (LLM ops) | (none) | Vercel AI Gateway key (`vck_*`) |
| `QUOTH_LLM_MODEL` | No | `google/gemini-2.5-flash-lite` | Override LLM model |
| `MOONSHOT_API_KEY` | No | (none) | Legacy fallback for LLM (Kimi K2.5 direct) |
