# Spec: Simplified Pipeline — Intent-Driven Pattern Extraction

**Version**: 1.2
**Date**: 2026-04-09
**Status**: Approved (brainstorming complete, adversarial review incorporated, codebase audit applied)

## Problem

The v3.4 daemon pipeline (JUDGE → DISTILL → CONSOLIDATE) is overengineered:

1. **JUDGE is redundant** — session_summary already provides success_rate, outcome, and user_intents. Classifying individual tool_use entries as effective/ineffective adds a full LLM call for signal that the session-level summary gives us for free.
2. **DISTILL forces arbitrary caps** — hardcoded max of ~3 patterns per session (`distill-batch.js:81`). Routine sessions produce noise patterns to fill the quota; rich sessions get truncated. The LLM should decide how many patterns genuinely emerged.
3. **CONSOLIDATE is premature dedup** — an LLM call per pattern to compare against top-3 similar. Embedding dedup at write time already exists (`daemon.js:662-668`, `findDuplicateByEmbedding` at 0.92 threshold). CONSOLIDATE is redundant overhead on top of that. Deduplication should be a periodic maintenance task, not inline in every session's pipeline.
4. **Patterns lose context** — terse 80-char patterns strip the situation that produced them. "Parallel file reads" doesn't encode *when* or *why* to use it. The pattern text should carry enough context and intention that embedding similarity naturally matches future situations.
5. **Feedback is global-only** — a pattern gets alpha++ or beta++ regardless of context. A pattern great for refactoring but useless for debugging has one blended score.

## Design: Single-Stage EXTRACT Pipeline

Replace three LLM stages with one. Patterns carry rich context. Feedback is contextual.

### What Changes

| Current (v3.4) | New (v4) |
|---|---|
| 3 LLM stages: JUDGE → DISTILL → CONSOLIDATE | 1 LLM call: **EXTRACT** |
| JUDGE classifies per-entry effectiveness + domain | Removed — session_summary is the signal |
| DISTILL forces ~3 patterns max per session | EXTRACT returns 0-N — as many as genuinely relevant |
| CONSOLIDATE deduplicates per pattern via LLM | Removed — embedding dedup at write time, periodic maintenance for deeper cleanup |
| Patterns terse (80 chars) | Rich natural language (~100-200 chars) encoding context + intention |
| Global alpha/beta only | Global Bayesian + contextual `pattern_outcomes` table |
| Tags mutable by feedback | Tags static at extraction, enrichable by nightly maintenance (see below) |

### Pipeline Flow

```
Session ends (hook-dispatch.js, non-LLM, unchanged)
  │
  ▼
session_summary written to JSONL + SIGUSR1 to daemon
  │
  ▼
Daemon picks up session_summary
  │
  ▼
EXTRACT (single LLM call)
  ├─ Primary: claude -p Sonnet --effort low ($0)
  ├─ Fallback: Gemini 2.5 Flash via AI Gateway (~$0.003)
  ├─ All errors logged to pipeline_errors table (never silent)
  │
  ├─ Input:
  │    - session_summary (outcome, success_rate, user_intents, tool_counts)
  │    - tool_use entries from JSONL (max 30 recent for this session)
  │
  ├─ Output: 0-N patterns, each with:
  │    - pattern: rich NL text (~100-200 chars, encodes context + intention)
  │    - tags: static domain descriptors (e.g., ["refactoring", "workflow", "parallel"])
  │    - intention: what the user was trying to accomplish
  │    - quality_signal: LLM assessment of reusability (0.0-1.0)
  │
  ├─ Quality bar: LLM instructed to be STRICT —
  │    - Obvious actions are NOT patterns ("read a file then edit it")
  │    - Only genuine techniques/workflows that would help in similar future situations
  │    - 0 patterns is a valid output for routine sessions
  │
  ▼
Embedding (MiniLM-L6 local, $0)
  ├─ Embed pattern text ONLY (not concatenated with intention)
  ├─ Rationale: query embeddings at injection time are raw user prompts,
  │   so pattern embeddings must match that format. Concatenating
  │   "| Intent: ..." creates a query-document mismatch that MiniLM-L6
  │   384d can't bridge. Intention is stored in the DB for contextual
  │   feedback but does not influence the embedding.
  │
  ▼
Dedup check per pattern (no LLM)
  ├─ Cosine similarity against existing patterns in HNSW
  ├─ If similarity > threshold → skip insertion (too close to existing)
  ├─ Threshold configurable via QUOTH_DEDUP_THRESHOLD (default 0.92)
  ├─ Skipped duplicates logged (not silent)
  │
  ▼
Insert to SQLite (patterns table)
  ├─ Initial alpha/beta derived from quality_signal (see formula below)
  ├─ Tags stored as JSON array (static, never mutated by feedback)
  ├─ format_version = 2 (distinguishes from v3.4 terse patterns)
  │
  ▼
Session feedback (non-LLM, in session-end hook, existing mechanism)
  ├─ For each injected pattern this session:
  │    ├─ Global Bayesian update: alpha++ or beta++ based on session outcome
  │    ├─ Contextual outcome: record in pattern_outcomes table
  │    │    (pattern_id, intention, outcome, context_embedding)
  │    ├─ Intention dedup: if embedding > 0.92 similarity to existing outcome → skip
  │    └─ Strengthen or penalize: update pattern for THIS intention/context
  │         even if overall pattern confidence is high, a failure for a specific
  │         intention is recorded as negative signal for that context
```

### Initial Alpha/Beta from Quality Signal

The LLM assigns a categorical quality_signal. Code maps it to initial Bayesian priors:

| Label | Quality Score | Initial Alpha | Initial Beta | Starting Confidence |
|-------|--------------|---------------|--------------|---------------------|
| `universal` | 0.9 | 3 | 1 | 0.75 |
| `domain` | 0.7 | 2 | 1 | 0.67 |
| `project` | 0.5 | 1 | 1 | 0.50 |
| `edge_case` | 0.3 | 1 | 2 | 0.33 |

This replaces the flat `confidence: 0.55` used by the current `insertNewPattern()`. Higher-quality patterns start with stronger priors, meaning they need fewer positive observations to reach injection threshold.

### EXTRACT Prompt Design

The single LLM call replaces JUDGE + DISTILL + CONSOLIDATE. The prompt is **deliberately scoped down** from three-stage complexity — it does NOT try to replicate all three stages in one shot. Specifically:

1. Assess session quality (was this productive or routine?)
2. Extract genuinely reusable patterns (not obvious tool sequences)
3. Include sufficient context and intention in each pattern

**What the prompt does NOT do** (moved to write-time or maintenance):
- Dedup against existing patterns — handled by embedding similarity at write time (configurable threshold)
- Domain classification — tags are LLM-assigned descriptors, not the 8-domain routing taxonomy
- Quality calibration — `quality_signal` uses categorical anchors (see table above), not free-form 0-1

> **Rationale:** The v3.4 pipeline failed not because each stage was wrong, but because chaining 3 LLM calls created compounding error and latency. EXTRACT succeeds by doing *less per call*, not by cramming 3 calls into 1. Dedup and classification are cheaper and more reliable as deterministic post-processing.

```
You are analyzing a coding session to extract reusable patterns.

SESSION:
- Project: {{project}}
- Outcome: {{outcome}} (success rate: {{success_rate}}%)
- User intent: {{user_intents}}
- Tools used: {{tool_summary}}

RECENT ACTIONS (chronological):
{{tool_entries formatted as: tool → task_snippet → outcome}}

TASK:
1. Was this session productive or routine? Routine sessions (just reading files,
   standard edits) produce NO patterns. Only extract from sessions where a genuine
   technique or workflow emerged.
   (Note: deduplication against existing patterns is handled at write time via
   embedding similarity — do NOT spend prompt tokens listing existing patterns here)

2. For productive sessions, extract EVERY relevant pattern. No minimum, no maximum.
   Each pattern must be:
   - A reusable technique/workflow, NOT a specific file path or command
   - Rich enough to match similar future situations via embedding search
   - Include context: when/why to use this approach
   - Include intention: what problem it solves

3. For each pattern, assess reusability using ONE of these labels:
   - "universal": technique applicable across any project → maps to 0.9
   - "domain": applicable to similar project types → maps to 0.7
   - "project": applicable within this specific domain → maps to 0.5
   - "edge_case": narrow, might be useful occasionally → maps to 0.3
   (Labels mapped to numeric in code, NOT by the LLM — avoids miscalibration)

EXAMPLES of GOOD patterns:
- "When refactoring across multiple files in a monorepo, read all target files in
  parallel before making batch edits to ensure consistency and catch dependencies"
- "For debugging intermittent test failures, isolate the failing test first with
  .only, then add verbose logging to the setup/teardown lifecycle hooks"

EXAMPLES of BAD patterns (do NOT extract these):
- "Read file then edit it" (obvious)
- "Run npm test after changes" (standard practice)
- "Use git commit to save changes" (trivial)

Respond with JSON:
{
  "session_type": "productive" | "routine",
  "patterns": [
    {
      "pattern": "rich description with context and intention (100-200 chars)",
      "tags": ["domain1", "domain2"],
      "intention": "what the user was trying to accomplish",
      "quality_signal": "universal" | "domain" | "project" | "edge_case"
    }
  ]
}

If routine, return {"session_type": "routine", "patterns": []}
```

### Model Strategy

```
Primary:   claude -p Sonnet --effort low  ($0, Max plan, ~15-30s)
Fallback:  Gemini 2.5 Flash via AI Gateway (~$0.003, ~5-8s)
```

Fallback triggers when:
- claude -p fails (timeout, exit code != 0, invalid JSON)
- Error is logged to `pipeline_errors` with full context before fallback attempt
- If fallback also fails, error logged, session skipped (no silent swallowing)

### Managed Mode

**Decision: Managed mode uses EXTRACT locally.**

`processSessionManaged()` currently sends sessions to `POST /api/v1/pipeline/process`, which runs the 3-stage pipeline server-side. After this change:

1. Managed mode runs EXTRACT locally (same as local mode) — the primary model (`claude -p`) is available on any machine with Claude CLI, and the fallback (Gateway) only needs `AI_GATEWAY_API_KEY`.
2. The cloud `pipeline/process` endpoint is **not updated** in this spec. Managed users who lack both Claude CLI and Gateway key fall back to the existing cloud pipeline (3-stage) as a degraded path.
3. The `QUOTH_MODE=managed` flag continues to control cloud promotion and pull behavior — it just no longer controls the extraction pipeline.

**Migration path:** If managed-only users exist (no local Claude CLI, no Gateway key), they continue using the cloud 3-stage pipeline until the cloud API is updated to v2 in a future spec.

---

## New Tables

### `pattern_outcomes`

Contextual feedback: tracks how each pattern performed for specific intentions.

```sql
CREATE TABLE IF NOT EXISTS pattern_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  intention TEXT NOT NULL,
  intention_embedding TEXT,         -- 384d MiniLM vector (JSON)
  outcome TEXT NOT NULL,            -- 'success' | 'failure' | 'partial'
  session_context TEXT,             -- JSON: { project, agent_type, description }
  session_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_po_pattern ON pattern_outcomes(pattern_id);
CREATE INDEX IF NOT EXISTS idx_po_created ON pattern_outcomes(created_at);
```

**Rolling window**: max 20 outcomes per pattern. On insert, if count > 20 for that pattern_id, delete the oldest entries.

**Dedup at write**: before inserting, embed the intention and compare against existing outcomes for that pattern. If cosine similarity > 0.92 to an existing outcome with the same result, skip (avoid redundant entries).

### `pipeline_errors`

Error visibility — no silent failures.

```sql
CREATE TABLE IF NOT EXISTS pipeline_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,              -- 'extract', 'embed', 'dedup', 'feedback'
  error_message TEXT NOT NULL,
  error_stack TEXT,
  context TEXT,                     -- JSON: { session_id, project, entry_count, model }
  model_attempted TEXT,
  fallback_attempted INTEGER DEFAULT 0,
  fallback_succeeded INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

---

## Injection Pipeline (Pattern Selection)

Updated to use contextual outcome data when ranking candidates.

```
User prompt arrives
  │
  ├─ 1. Embed prompt (MiniLM, $0)
  ├─ 2. HNSW search → top N candidates by embedding similarity to prompt
  ├─ 3. Tag filter (if agent type known from routing)       ← TAGS (coarse gate)
  ├─ 4. Outcome rerank:                                     ← OUTCOMES (fine signal)
  │      embed current prompt → compare against stored intention embeddings
  │      in pattern_outcomes for each candidate
  │      - Similar intention + success → boost score
  │      - Similar intention + failure → penalize score
  │      - No similar intention → neutral (global confidence stands)
  ├─ 5. Thompson sample from reranked candidates
  └─ 6. Inject by relevance threshold (no arbitrary cap)
```

**Tags and outcomes never contradict** because they operate at different stages:
- Tags = what the pattern is *about* → pre-filtering (static, set at extraction)
- Outcomes = where the pattern *worked or failed* → reranking (dynamic, accumulated)
- Tags never change from feedback. Outcomes never affect tag values.

---

## Session-End Feedback (Contextual)

At session end, for each pattern that was injected during this session:

1. **Pattern was used + session succeeded** → 
   - Global: alpha++ (existing Bayesian update)
   - Contextual: insert `pattern_outcomes` row with intention=session intent, outcome='success'
   
2. **Pattern was injected but unused / session failed** →
   - Global: beta++ (existing Bayesian update)
   - Contextual: insert `pattern_outcomes` row with intention=session intent, outcome='failure'
   - This is a guardrail: even if the pattern has high global confidence, a failure for a specific intention is negative signal for *that context*

3. **Pattern was used + session failed** →
   - Global: beta += 0.5 (half-penalty — used but didn't help, weaker signal than "injected and ignored")
   - Contextual: insert outcome='partial' — the pattern was relevant enough to use but the session still failed
   - **Rationale:** Skipping global updates for this case loses signal. Repeated "used but failed" should eventually drag down confidence. The 0.5 increment (vs full +1) reflects the ambiguity — the pattern may not have caused the failure, but it also didn't prevent it.

---

## Periodic Maintenance

Runs on the existing nightly schedule (03:00 ART / 06:00 UTC), extending current deep consolidation:

### Pattern Dedup (LLM-assisted)
- Find pattern pairs with embedding similarity > 0.88
- LLM decides which to keep (richer text wins), merges tags (union), sums alpha/beta
- Losing pattern archived (status='merged'), its pattern_outcomes transferred to winner

### Outcome Pruning
- For each pattern with > 20 outcomes: keep 20 most recent, delete oldest
- Deduplicate outcomes: if two outcomes for same pattern have intention similarity > 0.92 and same result, keep the most recent

### Tag Enrichment (no LLM)
- For each pattern with >=5 outcomes: extract unique tags from `session_context.agent_type` across successful outcomes
- If a pattern consistently succeeds in a domain not in its original tags (>=3 successes), append that domain tag
- Tags are only *added*, never removed — enrichment is additive
- This prevents the "good pattern, missing tag" problem where a pattern useful for debugging was only tagged ["refactoring"] because that was the original extraction context

### Error Review
- Flag unresolved `pipeline_errors` older than 7 days in daemon.log
- Surface recurring errors (same stage + similar error_message) as warnings

---

## Files Deleted

| File | Reason |
|------|--------|
| `pipeline/batch-judge.js` | JUDGE stage removed |
| `pipeline/judge.js` | JUDGE fallback removed |
| `pipeline/consolidate.js` | CONSOLIDATE stage removed |
| `pipeline/distill.js` | Individual distill removed (replaced by EXTRACT) |
| `pipeline/distill-batch.js` | Batch distill removed (replaced by EXTRACT) |

**NOT deleted (different purpose, preserved intact):**
- `daemon/lib/judge.js` — Pairwise LLM-as-Judge for V2 cluster uncertainty. Unrelated to the JUDGE pipeline stage. Used by `enqueueJudgePairs()` + `runJudgeBatch()` in the nightly and V2 mini-pipeline.

## Files Created

| File | Purpose |
|------|---------|
| `pipeline/extract.js` | Single EXTRACT stage (claude -p primary, Gateway fallback) |

## Files Modified

| File | Changes |
|------|---------|
| `daemon/daemon.js` | **Imports:** Remove `judge.js`, `distill.js`, `distill-batch.js`, `consolidate.js` pipeline imports. Add `extract.js` import. **State removal:** Remove `pendingJudge[]`, `judgedEffective[]`, `JUDGE_BATCH_SIZE`, `DAILY_JUDGE_CAP`, `dailyJudgeCount`, `dailyJudgeDate`. Rename `DAILY_DISTILL_CAP` → `DAILY_EXTRACT_CAP` (with backward-compat fallback: `process.env.QUOTH_DAILY_EXTRACT_CAP \|\| process.env.QUOTH_DAILY_DISTILL_CAP \|\| '50'`). Rename `distilledSessions` → `extractedSessions`, `dailyDistillCount` → `dailyExtractCount`. **Functions removed:** `flushJudgeQueue()` (entire function, ~50 lines). `startJudgeFlushTimer()` + `judgeFlushTimer` variable (5-min partial judge flush timer). **Functions simplified:** `processEntry()` — remove `if (entry.event === 'tool_use')` branch that accumulated entries into `pendingJudge`. Non-summary entries are now just marked processed. `processSessionBatch()` — remove JUDGE flush logic (lines 388-437), remove domain computation from judged entries, call `extract()` instead of `distillBatch()`. `applyDistilledPattern()` — remove `consolidate()` call for local mode (lines 627-654). Use embedding dedup only. **Timers:** Remove `judgeFlushTimer` from `clearTimers()`. SIGUSR1 handler: remove `await flushJudgeQueue()` call. **insertNewPattern():** Set `format_version: 2`, use quality_signal-derived alpha/beta (see formula above) instead of flat `confidence: 0.55`. |
| `daemon/db.js` | Add `pipeline_errors` table + `insertPipelineError()` helper. Add `format_version INTEGER NOT NULL DEFAULT 1` column migration on patterns. Make `findDuplicateByEmbedding()` read threshold from `QUOTH_DEDUP_THRESHOLD` env var (default 0.92). |
| `daemon/lib/injection.js` | Add outcome reranking step after Thompson sampling. Query pattern_outcomes, embed current prompt, compare against stored intentions. |
| `daemon/lib/query-server.js` | Pass outcome rerank results through to injection response. |
| `hooks/hook-dispatch.js` | Extend session-end feedback to write pattern_outcomes entries. |

## What Stays Unchanged

- `hooks/hook-dispatch.js` session_summary generation (non-LLM aggregation, lines 404-475)
- `hooks/trajectory-capture.js` JSONL logging
- `daemon/db.js` core: upsertPattern, applyBayesianUpdate, HNSW, searchBySimilarity
- `daemon/lib/embed.js` MiniLM local embeddings
- `daemon/lib/query-server.js` socket protocol (only injection ranking logic changes)
- `daemon/lib/judge.js` — pairwise cluster uncertainty judge (NOT the removed JUDGE stage)
- `daemon/lib/curation.js` — weekly dedup + retirement via pairwise judge
- All MCP tools (22)
- All hooks except session-end feedback extension
- Thompson sampling in injection.js (extended with outcome rerank, not replaced)
- `detectProjectFromTask()` — still needed for session_summary project resolution
- `runDeepConsolidate()` — nightly LLM dedup uses inline `claude -p Haiku` prompt, NOT the removed `pipeline/consolidate.js`
- V2 mini-pipeline (`startV2MiniTimer`) — calls `enqueueJudgePairs()` + `runJudgeBatch()` which use `daemon/lib/judge.js` (pairwise cluster judge), not the removed JUDGE stage
- `processSessionManaged()` — preserved as degraded fallback for managed-only users without local Claude CLI or Gateway key

---

## Migration Plan

The existing pattern library (384d MiniLM embeddings, terse 80-char names) must coexist with new rich patterns. A hard migration would lose all accumulated Bayesian priors.

### Strategy: Gradual Coexistence

1. **No re-embedding or re-extraction of existing patterns.** Old terse patterns keep their embeddings, alpha/beta, and exposure history. They compete with new rich patterns via the same Thompson sampling.

2. **Add `format_version` column to patterns table:**
   ```sql
   ALTER TABLE patterns ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1;
   ```
   - `format_version = 1`: terse v3.4 patterns (80 chars, no intention field)
   - `format_version = 2`: rich v4 patterns (100-200 chars, intention + quality_signal stored)

3. **Injection treats both formats equally.** Thompson sampling doesn't care about format — it scores by alpha/beta. Rich patterns will naturally win over time because they embed more semantically and match more situations.

4. **Natural attrition replaces old patterns.** The existing decay mechanism (exposure-based, 30d archive for never-exposed) will gradually retire terse patterns that stop getting injected. No explicit purge needed.

5. **Nightly dedup handles cross-format merges.** If a new rich pattern is semantically identical to an old terse one (similarity > 0.88), the nightly LLM dedup merges them — rich text wins, alpha/beta summed, old pattern archived as `status='merged'`.

### Rollback

If EXTRACT produces worse patterns than the 3-stage pipeline (measured by injection-to-use ratio over 2 weeks):
- Revert `daemon.js` to call batch-judge + distill-batch + consolidate
- New tables (`pattern_outcomes`, `pipeline_errors`) are harmless to keep
- `format_version=2` patterns can coexist — no schema rollback needed

---

## Dedup Threshold Calibration

The cosine similarity threshold is critical — it's the only dedup mechanism replacing the CONSOLIDATE LLM stage. With MiniLM-L6 384d (lower resolution than the previous voyage 1024d), this must be validated.

### Calibration Procedure (Phase 0 — run before implementation)

**Deliverable:** A script that outputs recommended threshold based on the current pattern library.

1. **Export current pattern pairs** from the existing library (~600 patterns max):
   ```js
   // Compute pairwise similarity for top 100 patterns by confidence
   // Log pairs with similarity in [0.85, 0.95] range
   ```

2. **Manual review of borderline pairs:** For pairs in the 0.88-0.95 range, classify as "same technique" or "different technique". This gives ground truth for threshold selection.

3. **Set threshold based on precision/recall tradeoff:**
   - Too high (0.95+): near-dupes slip through → pattern bloat
   - Too low (0.85): valid variations blocked → missed learning
   - Target: >=90% precision (flagged dupes are actually dupes) at >=70% recall

4. **Threshold is configurable** via env var `QUOTH_DEDUP_THRESHOLD` (default 0.92). This allows tuning without code changes if the initial value proves wrong.

### Monitoring

Track in `pipeline_errors` (or a new `dedup_log` table):
- Patterns skipped by dedup: count per day, average similarity score
- If >50% of extracted patterns are skipped as dupes, the threshold is too low or EXTRACT is producing repetitive output

---

## Embedding Strategy

**Pattern embeddings use pattern text only** — not concatenated with intention or tags.

### Rationale

At injection time, the query embedding is the raw user prompt (e.g., "refactor the auth module to use middleware"). The stored pattern embedding must match this format. If we embed `"pattern text | Intent: what user was doing"`, the `| Intent:` suffix shifts the embedding vector away from the query space. MiniLM-L6 384d doesn't have enough capacity to bridge this format mismatch.

The intention field is stored in the patterns table and in `pattern_outcomes` for contextual feedback. It influences **outcome reranking** (Phase 1B) but not the embedding.

### What gets embedded

```js
const embeddingText = pattern.pattern  // just the rich pattern text (100-200 chars)
```

This is sufficient because the EXTRACT prompt already produces patterns with embedded context:
- "When refactoring across multiple files in a monorepo, read all target files in parallel..."
- The context and intention are *in* the pattern text, not appended as metadata.

---

## Implementation Phasing

The spec is split into phases to reduce risk. Phase 0 validates the dedup threshold. Phase 1A is the core simplification. Phase 1B adds contextual feedback only after EXTRACT is validated.

### Phase 0: Dedup Calibration (run once before any code changes)

- [ ] Script to compute pairwise similarity for top 100 patterns in [0.85, 0.95] range
- [ ] Manual review of borderline pairs → set initial `QUOTH_DEDUP_THRESHOLD`
- [ ] Document findings (how many near-dupes exist, recommended threshold)

### Phase 1A: Core Pipeline (implement after Phase 0)

- [ ] `pipeline/extract.js` — single EXTRACT stage with categorical quality_signal
- [ ] `daemon.js` — remove JUDGE state/functions, rewire processSessionBatch to call extract(), remove consolidate() from applyDistilledPattern(), update insertNewPattern() with quality_signal-derived alpha/beta
- [ ] `db.js` — add `pipeline_errors` table, `format_version` column, configurable dedup threshold, `insertPipelineError()` helper
- [ ] Embedding dedup at write time (cosine > threshold → skip + log)
- [ ] Migration: ALTER TABLE patterns ADD format_version
- [ ] Env var backward compat: `QUOTH_DAILY_EXTRACT_CAP || QUOTH_DAILY_DISTILL_CAP || '50'`
- [ ] Delete pipeline files: `batch-judge.js`, `judge.js` (pipeline/), `consolidate.js`, `distill.js`, `distill-batch.js`
- [ ] Update/delete tests: `batch-judge.test.js`, `consolidate.test.js`, `distill.test.js`, `judge.test.js`
- [ ] New tests: verify EXTRACT produces patterns, dedup works, errors logged, format_version=2 set, quality_signal→alpha/beta mapping correct
- [ ] Verify nightly pipeline unaffected: `runDeepConsolidate()`, V2 mini-pipeline, curation

**Validation gate:** Run Phase 1A for 1 week. Compare injection-to-use ratio vs v3.4 baseline. If ratio improves or holds, proceed to 1B.

### Phase 1B: Contextual Feedback (implement after validation)

- [ ] `db.js` — add `pattern_outcomes` table, insertOutcome(), getOutcomesForPattern(), pruneOutcomes()
- [ ] `hooks/hook-dispatch.js` — extend session-end to write pattern_outcomes entries
- [ ] `daemon/lib/injection.js` — outcome reranking step after Thompson sampling
- [ ] Nightly maintenance: outcome pruning, error review
- [ ] Tests: verify contextual feedback updates, outcome reranking

---

## Future Phases (Not In This Spec)

These features are compatible with the new architecture but deferred:

### Phase 2: RLAIF Outcome Scoring
One cheap LLM call (Haiku, ~$0.001) per session to evaluate "did this session achieve its goal?" on a 0.0-1.0 scale. Would replace the heuristic 7-level reward signal with a more accurate assessment. Influences initial pattern confidence (high-quality sessions → higher starting confidence). Daily cap of 30 calls (~$0.03/day max).

### Phase 3: Temporal Co-occurrence
Track that "pattern B works after pattern A" via a `pattern_sequences` table recording pairwise co-occurrence in successful sessions. During injection, boost patterns that are temporal neighbors of already-selected patterns. Zero LLM calls — purely based on co-occurrence statistics.

### Phase 4: Cross-org Pattern Sharing
Opt-in anonymous pattern exchange between organizations. High-confidence patterns (>0.8, >10 uses) auto-promoted to Quoth cloud. Requires cloud-side dedup and quality review.

---

## Cost & Complexity Comparison

**Primary win: complexity and latency reduction, not cost.**

| | v3.4 (current) | v4 (this spec) |
|---|---|---|
| **JUDGE** | Gemini 2.5 Flash (~$0.001/batch of 60) | Removed |
| **DISTILL** | Gemini 2.5 Flash (~$0.003/session) | Removed |
| **CONSOLIDATE** | claude -p --effort low ($0) per pattern | Removed |
| **EXTRACT** | — | claude -p Sonnet --effort low ($0), Gateway fallback (~$0.003) |
| **Embeddings** | MiniLM local ($0) | MiniLM local ($0) |
| **Daily cost** | ~$0.03-0.05 | $0 primary, ~$0.003 on fallback |
| **LLM calls/session** | 2-4 | 1 |
| **Failure points/session** | 3-4 (each stage can fail independently) | 1 (single call + deterministic post-processing) |
| **Latency/session** | ~30-60s (sequential stages) | ~15-30s (one call) |
| **Daily caps to manage** | DAILY_JUDGE_CAP(200) + DAILY_DISTILL_CAP(50) | Single daily cap (DAILY_EXTRACT_CAP) |

The real savings are operational: fewer moving parts, fewer failure modes, one model to tune instead of three stages with independent prompts. The $0.03/day cost difference is negligible.

## Success Criteria

### Phase 0 (dedup calibration)

1. **Threshold validated:** Reviewed >=20 borderline pairs manually. Precision >=90% at chosen threshold.
2. **Script committed:** Calibration script available for re-running if embedding model changes.

### Phase 1A (measurable after 1 week)

1. **Fewer patterns per session:** Average patterns extracted < 3 (v3.4 always outputs ~3). Routine sessions should produce 0.
2. **Higher injection-to-use ratio:** Patterns injected in sessions should be "used" (post-task hook fires) at >= current baseline rate. Track via `injection_log`.
3. **No silent errors:** Every pipeline failure logged in `pipeline_errors` with stage, model, context. Zero silent swallowing.
4. **Dedup effectiveness:** <15% of extracted patterns skipped by embedding dedup (indicates EXTRACT isn't producing redundant output).
5. **Latency improvement:** Pipeline processing time per session < 30s (vs current 30-60s for 3-stage).
6. **Nightly pipeline unbroken:** `runDeepConsolidate()`, V2 mini-pipeline, and curation run without errors.

### Phase 1B (measurable after 2 weeks on top of 1A)

7. **Contextual feedback reduces bad injections:** Patterns with >=3 contextual failures for an intention should rank lower for similar future prompts (verified by manual spot-check of injection logs).
8. **Outcome table stays lean:** Average outcomes per pattern < 10 (rolling window + dedup keeps it bounded).
