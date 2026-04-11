<!-- version: 1.0.4 | updated: 2026-04-11 -->

# Confidence Scoring

Quoth uses Bayesian confidence scoring based on the Beta distribution to track the reliability of learned patterns over time. Each pattern accumulates evidence (successes and failures) that updates its posterior probability, with temporal decay ensuring stale patterns naturally lose prominence.

Source files:
- `quoth-plugin/daemon/db.js` -- Bayesian update, decay, archival, promotion functions
- `quoth-plugin/mcp/handlers/intelligence.js` -- intelligence graph confidence (separate system)
- `quoth-plugin/hooks/hook-dispatch.js` -- feedback bridge between intelligence graph and SQLite

## Model: Beta Distribution

Each pattern in the `patterns` SQLite table has the following scoring columns:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `alpha` | REAL | 1 | Success parameter of the Beta distribution *(runtime migration)* |
| `beta` | REAL | 1 | Failure parameter of the Beta distribution *(runtime migration)* |
| `confidence` | REAL | 0.5 | Point estimate: `alpha / (alpha + beta)` |
| `success_count` | INTEGER | 0 | Total successes recorded |
| `failure_count` | INTEGER | 0 | Total failures recorded |
| `exposure_count` | INTEGER | 0 | Number of times injected into agent context *(runtime migration)* |
| `last_exposed_at` | INTEGER | NULL | Unix timestamp (ms) of last injection *(runtime migration)* |
| `ignored_count` | INTEGER | 0 | Injections where pattern was shown but not acted upon *(runtime migration)* |
| `decay_rate` | REAL | 0.005 | Reserved; not currently used by `applyHourlyDecay()` |
| `last_matched_at` | INTEGER | NULL | Unix timestamp (ms) of last match/use |

Note: `alpha` and `beta` are not in the base `CREATE TABLE` schema -- they are added to existing databases via `ALTER TABLE` runtime migrations in `createDb()`. New databases created from scratch also receive them via migration immediately after table creation.

### Initial State

A new pattern starts with `alpha=1, beta=1`, which yields `confidence=0.5`. In Bayesian terms, this is a uniform prior Beta(1,1) -- maximum uncertainty, no bias toward success or failure. The confidence of 0.5 represents "we have no evidence either way."

### Why Beta Distribution

The Beta distribution is the conjugate prior for Bernoulli trials (success/failure observations). This means each observation can be incorporated with a simple increment to alpha or beta, with no expensive recomputation. The posterior mean `alpha / (alpha + beta)` is the natural point estimate that smoothly converges toward the true success rate as evidence accumulates.

## Bayesian Update

Implemented in `db.js: applyBayesianUpdate(id, outcome)`.

### On Success

sql
UPDATE patterns SET
  alpha = alpha + 1,
  success_count = success_count + 1,
  confidence = (alpha + 1.0) / (alpha + 1.0 + beta),
  last_matched_at = NOW(),
  updated_at = NOW()
WHERE id = ?
The confidence formula `(alpha + 1.0) / (alpha + 1.0 + beta)` computes the posterior mean after incrementing alpha. Note that SQLite evaluates this using the pre-update value of alpha, so `alpha + 1.0` in the formula represents the new alpha value.

### On Failure

```sql
UPDATE patterns SET
  beta = beta + 1,
  failure_count = failure_count + 1,
  confidence = alpha / (alpha + beta + 1.0),
  last_matched_at = NOW(),
  updated_at = NOW()
WHERE id = ?
```

Similarly, `alpha / (alpha + beta + 1.0)` computes the posterior mean after incrementing beta.

### Properties

- **Self-correcting**: A pattern that fails frequently will see its confidence drop toward 0 as beta grows relative to alpha.
- **Diminishing returns**: Early observations have large effects (moving from 0.5 to 0.67 takes one success). Later observations have smaller effects (moving from 0.80 to 0.82 takes multiple successes). This is because the denominator `alpha + beta` grows.
- **Never reaches 0 or 1**: The posterior mean of Beta(a,b) is always in (0,1) for finite a,b > 0, preventing overconfidence.

## Feedback Sources

### 1. Daemon Pipeline (CONSOLIDATE phase)

When the background daemon processes trajectories through JUDGE -> DISTILL -> CONSOLIDATE, and CONSOLIDATE determines a new trajectory matches an existing pattern:

- `db.applyBayesianUpdate(targetId, 'success')` is called on the matched pattern.
- This is the primary mechanism for patterns to gain confidence from real agent work.
- Only successes are recorded here; the daemon does not currently record failures via Bayesian update.

### 2. SubagentStop Hook (post-task implicit feedback)

When a subagent completes (`SubagentStop` event), the `post-task` handler in `hook-dispatch.js` executes a three-phase feedback process:

**Phase 1 -- Intelligence graph update:**
```javascript
const result = intel.applyFeedback(true)  // always success (implicit)
```
This updates the JSON-based intelligence graph entries with +0.05 confidence.

**Phase 2 -- SQLite Bayesian update:**
```javascript
for (const id of result.boosted) {
  const patternId = id.startsWith('pat-') ? id.slice(4) : null
  if (patternId) {
    if (patternId.startsWith('doc:')) {
      db.updateDocChunkAlphaBeta(patternId.slice(4), 'success')
    } else {
      db.applyBayesianUpdate(patternId, 'success')
    }
  }
}
```
Only IDs with the `pat-` prefix are routed to SQLite. Within those, `doc:` prefixed IDs update the `doc_chunks` table via `db.updateDocChunkAlphaBeta()`, while regular IDs update the `patterns` table. Memory entries (`mem-` prefix) and insight entries (`insight-` prefix) are only updated in the intelligence graph JSON.

The IDs come from `last-matched.json`, which was written by the most recent `getContext` call during routing. This creates a feedback loop: patterns that were surfaced as relevant context and then led to a successful task completion get reinforced.

**Phase 3 -- Session memory feedback loop:**
```javascript
const fiveMinAgo = Date.now() - 5 * 60 * 1000
const recentUnused = Object.entries(injections)
  .filter(([, v]) => !v.used && v.at > fiveMinAgo)
  .map(([id]) => id)
const v2 = isSubFlag('injection')
for (const id of recentUnused) {
  sm.markPatternUsed(id)
  if (db) {
    if (v2) {
      db.updateInjectionOutcome(sessionId, id, 1.0)
    } else {
      db.applyBayesianUpdate(id, 'success')
    }
  }
}
```
Patterns that were injected into agent context in the last 5 minutes but not yet explicitly marked as used are treated as implicitly successful. In V1 mode this triggers a Bayesian success update; in V2 (bandit) mode it records a reward of 1.0 in the `injection_log` table for nightly SNIPS aggregation.

### 3. SessionEnd Hook (session-level feedback)

When a session ends (`SessionEnd` or `PreCompact` event), the `session-end` handler applies session-level feedback based on which injected patterns were used during the session.

**V1 mode** (default): patterns that were injected but never marked as used by the end of the session receive a soft-negative penalty via `applySoftNegative(db, stale)`. This penalises patterns that were consistently shown but never acted upon across full sessions (slower signal than the per-task SubagentStop update).

**V2 mode** (`injection` feature flag set): for each pattern that was logged in `injection_log` during the session, `db.updateInjectionOutcome(sessionId, pid, reward)` is called:
- Patterns marked as used receive `reward = 1.0`
- Unused patterns receive a reward derived from the overall session outcome (success/partial/failure), computed by `sessionOutcomeReward(events)` from the trajectory file

The session outcome reward allows partial credit: a session that completed successfully but didn't use a given pattern still contributes weak positive signal rather than a hard negative.

### 4. MCP Tools (explicit feedback)

Three MCP tools allow explicit feedback:

**`quoth_log_outcome(patternId, outcome)`** -- Direct Bayesian update with `'success'` or `'failure'` outcome. This is the only mechanism that allows explicit failure recording via Bayesian update.

**`quoth_score_pattern(patternId, delta)`** -- Routes through the Bayesian system: `delta > 0` calls `db.applyBayesianUpdate(id, 'success')`, `delta < 0` calls `db.applyBayesianUpdate(id, 'failure')`. This ensures all scoring goes through the proper Beta distribution update path.

**`quoth_intelligence_feedback(success)`** -- Updates the intelligence graph JSON entries only (not SQLite). Applies +0.05 for success, -0.02 for failure to entries in `last-matched.json`.

### 5. Search Match (`last_matched_at` tracking)

When `quoth_search_patterns` returns results from a semantic search:
```javascript
const now = Date.now()
for (const p of results) {
  db.prepare('UPDATE patterns SET last_matched_at = ? WHERE id = ?').run(now, p.id)
}
```
This marks patterns as "recently used" which protects them from inactivity decay penalties. The matched pattern IDs are also written to `last-matched.json` for potential subsequent feedback.

## Hourly Decay

Implemented in `db.js: applyHourlyDecay()`. Called every hour by the daemon's timer.

The decay model is **exposure-based**: only patterns with actual performance data are penalized. "No exposure = no data = no change." A pattern for a tool the user hasn't used recently should not decay simply due to the passage of time.

### Tier 1 -- Exposure-informed poor conversion

```sql
UPDATE patterns
SET beta = beta + 0.05,
    confidence = MAX(0.05, alpha / (alpha + beta + 0.05)),
    updated_at = NOW()
WHERE status = 'active'
  AND exposure_count >= 5
  AND (success_count * 1.0 / MAX(exposure_count, 1)) < 0.1
```

- Applies to patterns that have been injected into context at least 5 times but have a conversion rate below 10%.
- These patterns had real opportunities to help and consistently failed to. Beta grows at 0.05/hour.
- Never-exposed patterns (`exposure_count = 0`) are **not affected**.

### Tier 2 -- High-exposure dominance prevention

```sql
UPDATE patterns
SET alpha = MAX(0.1, alpha * 0.9995),
    confidence = MAX(0.05, MAX(0.1, alpha * 0.9995) / (MAX(0.1, alpha * 0.9995) + beta)),
    updated_at = NOW()
WHERE status = 'active'
  AND exposure_count > 20
```

- Applies only to patterns injected more than 20 times.
- Very gentle multiplicative alpha decay: `alpha *= 0.9995/hour` ≈ -3.5% per week.
- Prevents old high-confidence winners from dominating the injection pool indefinitely.

### Never-Exposed Patterns

Never-exposed patterns (`exposure_count = 0`) receive **no decay** from `applyHourlyDecay()`. Their confidence remains at the initial value (typically 0.5) until they are injected and real signal accumulates. Cleanup of truly stale never-exposed patterns is handled by `archiveWeakPatterns()` instead.

## Archival

Implemented in `db.js: archiveWeakPatterns()`. Called hourly by the daemon alongside `applyHourlyDecay()`.

### Criteria

Three archival rules run in `archiveWeakPatterns()`:

**Rule 1 -- Low confidence with sufficient exposure data:**
```sql
UPDATE patterns SET status = 'archived'
WHERE status = 'active'
  AND confidence < 0.1
  AND exposure_count >= 10
  AND (success_count * 1.0 / MAX(exposure_count, 1)) < 0.05
```
Archives patterns with at least 10 exposures and under 5% conversion rate that have low confidence. Requires real exposure data before archiving -- untested patterns are not eligible.

**Rule 2 -- Raw tool-call garbage with no feedback:**
```sql
UPDATE patterns SET status = 'archived'
WHERE status = 'active'
  AND confidence < 0.15
  AND (success_count + failure_count) = 0
  AND (name LIKE 'claude-code: Bash %' OR name LIKE 'claude-code: Write /%'
       OR name LIKE 'claude-code: Edit /%' OR name LIKE 'claude-code: Read /%')
```
Archives patterns created by the old distiller fallback that produced raw tool calls as names. These patterns have no reuse value and were never validated by feedback.

**Rule 3 -- Never-exposed patterns older than 30 days:**
```sql
UPDATE patterns SET status = 'archived'
WHERE status = 'active'
  AND exposure_count = 0
  AND (success_count + failure_count) = 0
  AND created_at < ?  -- 30 days ago
```
Archives patterns that were distilled but never injected into any agent context in 30 days. These are considered too niche or poorly worded to be useful. (Previously 90 days — reduced because patterns not injected in 30 days of active use are unlikely to ever be relevant.)

### Eager Pruning: `pruneYoungUnused()`

A separate, more aggressive cleanup function `db.pruneYoungUnused()` **deletes** (not archives) very recent patterns that already look like distiller noise:

```sql
DELETE FROM patterns
WHERE status = 'active'
  AND created_at < ?   -- older than 1 hour
  AND created_at > ?   -- but younger than 24 hours
  AND exposure_count = 0
  AND success_count = 0
  AND failure_count = 0
```

This removes patterns aged 1–24 hours with zero exposures and zero feedback. These are almost certainly low-quality distillations that have already been superseded or were never worth keeping. Unlike `archiveWeakPatterns()`, this permanently deletes records and runs on a tighter time window.

### Purpose

Archival removes patterns that are either unreliable (Rule 1), structurally useless (Rule 2), or chronically ignored (Rule 3).

Archived patterns:
- Are excluded from `getTopPatterns` queries (which filter `WHERE status = 'active'`)
- Are excluded from similarity search results
- Are excluded from promotion candidates
- Are NOT deleted -- they remain in the database and could theoretically be reactivated

## Promotion

Implemented in `db.js: getPromotionCandidates()`. The daemon checks for promotion candidates nightly at 3am.

### Criteria

```sql
SELECT * FROM patterns
WHERE confidence > 0.8
  AND (success_count + failure_count) > 10
  AND status = 'active'
  AND source = 'distilled'
```

A pattern must meet ALL conditions:
- **confidence > 0.8** -- strongly validated by evidence
- **total uses > 10** -- extensively tested (at least 11 successes + failures)
- **status = 'active'** -- not archived
- **source = 'distilled'** -- only patterns produced by the JUDGE -> DISTILL pipeline are eligible. Seeded patterns, skill-derived patterns, and manually attributed patterns are excluded.

### Promotion Flow

When promoted, the daemon:
1. Calls the Quoth cloud API to create/update the pattern document
2. Marks the local pattern with `promoted_at`, `cloud_document_id`, and `promoted_confidence`
3. The pattern continues to be active locally -- promotion is a copy, not a move

### Promotion Tracking Columns

| Column | Type | Description |
|--------|------|-------------|
| `promoted_at` | INTEGER | Timestamp when promoted to cloud |
| `cloud_document_id` | TEXT | ID of the cloud document |
| `promoted_confidence` | REAL | Confidence at time of promotion |
| `applicability` | TEXT | Default `'narrow'` -- scope of the pattern |

## Confidence Lifecycle Example

```
Event                         alpha  beta  confidence  Notes
---                           -----  ----  ----------  -----
Pattern created               1.0    1.0   0.500       Uniform prior
Success #1                    2.0    1.0   0.667       Quick rise
Success #2                    3.0    1.0   0.750
Success #3                    4.0    1.0   0.800       Nearing promotion threshold
Failure #1                    4.0    2.0   0.667       Significant drop
Success #4                    5.0    2.0   0.714
Success #5                    6.0    2.0   0.750
Success #6                    7.0    2.0   0.778
Success #7                    8.0    2.0   0.800
Success #8                    9.0    2.0   0.818       Promotion candidate (>0.8, >10 uses)
High-exposure dominance       ~8.9   2.0   ~0.816      Tier 2: alpha *= 0.9995/hr (>20 exposures)
Poor conversion begins        ~8.9   2.5   ~0.781      Tier 1: beta += 0.05/hr (≥5 exp, <10% conv)
Never exposed (30 days)       1.0    1.0   0.500       No decay; archived by Rule 3 at day 30
```

Note: Unlike previous versions, patterns are not penalized by `applyHourlyDecay()` based solely on time since last use. Decay only occurs when there is real exposure data (injections) indicating poor performance.

## Intelligence Graph Confidence (Separate System)

The intelligence graph in `handlers/intelligence.js` maintains its own confidence values in JSON files. These are independent of the SQLite Bayesian scores but correlated through the post-task hook.

### Key Differences

| Aspect | SQLite Bayesian | Intelligence Graph JSON |
|--------|----------------|------------------------|
| Storage | `patterns` table: `alpha`, `beta`, `confidence` | `graph-state.json` nodes, `ranked-context.json` entries |
| Update model | Beta distribution posterior mean | Direct additive: +0.05 / -0.02 |
| Decay | Exposure-based: Tier 1 (poor conversion) + Tier 2 (dominance prevention) | 0.005/day for unaccessed nodes > 24h old |
| Floor | alpha >= 0.1, confidence >= 0.05 | confidence >= 0.0 (clamped), node confidence >= 0.05 |
| Scope | Pattern entries only | All entries (memory, patterns, insights) |
| Feedback trigger | `quoth_log_outcome`, `post-task` hook, daemon CONSOLIDATE | `quoth_intelligence_feedback`, `post-task` hook |
| Archival | Yes, when exposure ≥10 with <5% conversion, or never exposed after 30 days | No archival mechanism |

### Bridge: post-task Hook

The `post-task` handler is the critical bridge between the two systems. When a subagent completes:

1. `applyFeedback(true)` updates all last-matched intelligence graph entries (+0.05 confidence in JSON)
2. For entries with `pat-` prefixed IDs, extracts the real pattern ID
3. Routes to the correct table: `doc:` prefixed IDs call `db.updateDocChunkAlphaBeta(chunkId, 'success')` (doc_chunks table); all others call `db.applyBayesianUpdate(patternId, 'success')` (patterns table)

This means a subagent completion reinforces patterns in both systems simultaneously, keeping them roughly aligned.

### Intelligence Graph Consolidation Decay

During `consolidateGraph()`, nodes that have never been accessed (`accessCount === 0`) and are older than 24 hours have their confidence reduced:

```javascript
node.confidence = Math.max(0.05, confidence - 0.005 * Math.floor(hours / 24))
```

This is a simple linear decay (0.005 per day), much gentler than the Bayesian hourly decay. It only affects the intelligence graph's JSON confidence values, not the SQLite Bayesian scores.

## Summary of All Confidence Modification Paths

| Path | System | Direction | Amount |
|------|--------|-----------|--------|
| `applyBayesianUpdate('success')` | SQLite | Up | alpha += 1, confidence recalculated |
| `applyBayesianUpdate('failure')` | SQLite | Down | beta += 1, confidence recalculated |
| `applyConfidenceDelta(id, delta)` | SQLite | Up/Down | confidence += delta (bypasses Bayesian) |
| `applyHourlyDecay` Tier 1 | SQLite | Down | beta += 0.05/hr (exposure_count ≥5, conversion <10%) |
| `applyHourlyDecay` Tier 2 | SQLite | Down | alpha *= 0.9995/hr (exposure_count >20) |
| `post-task` Phase 3 (V1) | SQLite | Up | Bayesian success for recently-injected unused patterns |
| `post-task` Phase 3 (V2) | injection_log | Up | reward=1.0 recorded for nightly SNIPS aggregation |
| `session-end` soft-negative (V1) | SQLite | Down | `applySoftNegative` on stale injections |
| `session-end` outcome reward (V2) | injection_log | Up/Down | reward=session outcome for all injected patterns |
| `applyFeedback(true)` | JSON graph | Up | +0.05 to matched entries |
| `applyFeedback(false)` | JSON graph | Down | -0.02 to matched entries |
| `consolidateGraph` decay | JSON graph | Down | -0.005/day for unaccessed nodes |
| Search match | SQLite | Neutral | Updates `last_matched_at` only |

