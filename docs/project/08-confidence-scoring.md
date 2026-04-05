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
| `alpha` | REAL | 1 | Success parameter of the Beta distribution |
| `beta` | REAL | 1 | Failure parameter of the Beta distribution |
| `confidence` | REAL | 0.5 | Point estimate: `alpha / (alpha + beta)` |
| `success_count` | INTEGER | 0 | Total successes recorded |
| `failure_count` | INTEGER | 0 | Total failures recorded |
| `decay_rate` | REAL | 0.005 | Controls hourly alpha decay speed |
| `last_matched_at` | INTEGER | NULL | Unix timestamp (ms) of last match/use |

### Initial State

A new pattern starts with `alpha=1, beta=1`, which yields `confidence=0.5`. In Bayesian terms, this is a uniform prior Beta(1,1) -- maximum uncertainty, no bias toward success or failure. The confidence of 0.5 represents "we have no evidence either way."

### Why Beta Distribution

The Beta distribution is the conjugate prior for Bernoulli trials (success/failure observations). This means each observation can be incorporated with a simple increment to alpha or beta, with no expensive recomputation. The posterior mean `alpha / (alpha + beta)` is the natural point estimate that smoothly converges toward the true success rate as evidence accumulates.

## Bayesian Update

Implemented in `db.js: applyBayesianUpdate(id, outcome)`.

### On Success

```sql
UPDATE patterns SET
  alpha = alpha + 1,
  success_count = success_count + 1,
  confidence = (alpha + 1.0) / (alpha + 1.0 + beta),
  last_matched_at = NOW(),
  updated_at = NOW()
WHERE id = ?
```

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

When a subagent completes (`SubagentStop` event), the `post-task` handler in `hook-dispatch.js` executes a two-phase feedback process:

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
    db.applyBayesianUpdate(patternId, 'success')
  }
}
```
Only IDs with the `pat-` prefix (pattern entries) are updated in SQLite. Memory entries (`mem-` prefix) and insight entries (`insight-` prefix) are only updated in the intelligence graph JSON.

The IDs come from `last-matched.json`, which was written by the most recent `getContext` call during routing. This creates a feedback loop: patterns that were surfaced as relevant context and then led to a successful task completion get reinforced.

### 3. MCP Tools (explicit feedback)

Three MCP tools allow explicit feedback:

**`quoth_log_outcome(patternId, outcome)`** -- Direct Bayesian update with `'success'` or `'failure'` outcome. This is the only mechanism that allows explicit failure recording via Bayesian update.

**`quoth_score_pattern(patternId, delta)`** -- Applies a raw confidence delta via `db.applyConfidenceDelta(id, delta)`:
```sql
UPDATE patterns SET
  confidence = MIN(1.0, MAX(0.0, confidence + delta)),
  success_count = CASE WHEN delta > 0 THEN success_count + 1 ELSE success_count END,
  failure_count = CASE WHEN delta < 0 THEN failure_count + 1 ELSE failure_count END,
  last_matched_at = NOW()
WHERE id = ?
```
Note: this bypasses the Bayesian alpha/beta system and directly modifies `confidence`. It also updates success/failure counts. Use `quoth_log_outcome` for proper Bayesian updates.

**`quoth_intelligence_feedback(success)`** -- Updates the intelligence graph JSON entries only (not SQLite). Applies +0.05 for success, -0.02 for failure to entries in `last-matched.json`.

### 4. Search Match (last_matched_at tracking)

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

### Alpha Decay (all active patterns)

```sql
UPDATE patterns SET
  alpha = MAX(0.1, alpha - (decay_rate * alpha * 0.01)),
  confidence = MAX(0.05, recalculated),
  updated_at = NOW()
WHERE status = 'active'
```

- Applied to ALL active patterns, regardless of activity.
- The decay is proportional to the current alpha value: `decay_rate * alpha * 0.01`.
- With the default `decay_rate=0.005`, this removes `0.005 * alpha * 0.01 = 0.00005 * alpha` per hour.
- Floor at `alpha=0.1` (not 1.0). This allows confidence to drop below the initial 0.5 because `0.1 / (0.1 + beta)` can be very small when beta is large.
- Confidence floor at 0.05 (never reaches absolute zero).
- Effect: patterns that are not being reinforced will gradually lose alpha, causing confidence to drift downward.

### Tiered Inactivity Penalties

Three tiers of increasing severity replace the previous single inactivity penalty:

**Tier 1 — Never matched (aggressive):**
```sql
UPDATE patterns SET
  beta = beta + 0.1,
  confidence = MAX(0.05, alpha / (alpha + beta + 0.1))
WHERE status = 'active'
  AND last_matched_at IS NULL
  AND (success_count + failure_count) = 0
```
- Applies to patterns that have NEVER been matched or used.
- Rate: 0.1/hour = 2.4 beta/day → confidence drops to ~0.3 within a week.
- Purpose: Quickly penalize patterns that were distilled but never proved useful.

**Tier 2 — Inactive >7 days (moderate):**
```sql
UPDATE patterns SET
  beta = beta + 0.05,
  confidence = MAX(0.05, alpha / (alpha + beta + 0.05))
WHERE status = 'active'
  AND last_matched_at IS NOT NULL
  AND last_matched_at < ?  -- 7 days ago
```
- Applies to patterns that WERE matched at some point but haven't been used recently.
- Rate: 0.05/hour = 1.2 beta/day → ~8.4 beta per week.
- Purpose: Moderate erosion for once-useful patterns that may have become stale.

**Tier 3 — Inactive >30 days (strong):**
```sql
UPDATE patterns SET
  beta = beta + 0.15,
  confidence = MAX(0.05, alpha / (alpha + beta + 0.15))
WHERE status = 'active'
  AND (last_matched_at IS NULL OR last_matched_at < ?)  -- 30 days ago
```
- Applies to ALL patterns inactive for more than 30 days, regardless of history.
- Rate: 0.15/hour = 3.6 beta/day → rapid confidence erosion.
- Purpose: Aggressively prune long-abandoned patterns. Note: this stacks with Tier 1 or Tier 2 for those patterns.

### Decay Interaction

All decay mechanisms run in the same `applyHourlyDecay()` call. For a never-matched pattern:

1. Alpha decreases by `0.00005 * alpha` (small)
2. Beta increases by 0.1 (Tier 1, significant)
3. After 30 days, additionally beta increases by 0.15 (Tier 3, stacking)

A pattern at alpha=1, beta=1 (never matched, default state):
- After 1 day: beta ~ 1 + 2.4 = 3.4, confidence ~ 1/(1+3.4) ~ 0.23
- After 1 week: beta ~ 1 + 16.8 = 17.8, confidence ~ 1/(1+17.8) ~ 0.05
- Triggers archival quickly, preventing garbage accumulation.

A well-established pattern at alpha=8, beta=2 that stops being used:
- After 7 days idle: Tier 2 kicks in, beta grows by ~8.4/week
- After 2 weeks: beta ~ 2 + 8.4 = 10.4, confidence ~ 8/(8+10.4) ~ 0.43
- After 30 days: Tier 3 stacks, accelerating decay further.
- Patterns with strong evidence take longer to die, as expected.

## Archival

Implemented in `db.js: archiveWeakPatterns()`. Called hourly by the daemon alongside `applyHourlyDecay()`.

### Criteria

Two archival rules run in `archiveWeakPatterns()`:

**Rule 1 — Low confidence with evidence:**
```sql
UPDATE patterns SET status = 'archived'
WHERE confidence < 0.1
  AND (success_count + failure_count) > 3
  AND status = 'active'
```
Archives patterns that have been tried multiple times and found unreliable. The threshold of 3 total uses (reduced from 5) allows faster cleanup while still protecting untested patterns.

**Rule 2 — Raw tool-call garbage with no feedback:**
```sql
UPDATE patterns SET status = 'archived'
WHERE status = 'active'
  AND confidence < 0.15
  AND (success_count + failure_count) = 0
  AND (name LIKE 'claude-code: Bash %' OR name LIKE 'claude-code: Write /%'
       OR name LIKE 'claude-code: Edit /%' OR name LIKE 'claude-code: Read /%')
```
Archives patterns created by the old distiller fallback that produced raw tool calls as names. These patterns have no reuse value and were never validated by feedback.

### Purpose

Archival removes patterns that are either unreliable (Rule 1) or structurally useless (Rule 2).

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
Event                       alpha  beta  confidence  Notes
---                         -----  ----  ----------  -----
Pattern created             1.0    1.0   0.500       Uniform prior
Success #1                  2.0    1.0   0.667       Quick rise
Success #2                  3.0    1.0   0.750
Success #3                  4.0    1.0   0.800       Nearing promotion threshold
Failure #1                  4.0    2.0   0.667       Significant drop
Success #4                  5.0    2.0   0.714
Success #5                  6.0    2.0   0.750
Success #6                  7.0    2.0   0.778
Success #7                  8.0    2.0   0.800
Success #8                  9.0    2.0   0.818       Promotion candidate (>0.8, >10 uses)
7 days inactive             ~9.0   ~5.4  ~0.625      Beta gained ~3.36 from inactivity
14 days inactive            ~9.0   ~8.7  ~0.508      Approaching initial uncertainty
Continued disuse            ~9.0   >90   <0.1        Archived after confidence < 0.1
```

## Intelligence Graph Confidence (Separate System)

The intelligence graph in `handlers/intelligence.js` maintains its own confidence values in JSON files. These are independent of the SQLite Bayesian scores but correlated through the post-task hook.

### Key Differences

| Aspect | SQLite Bayesian | Intelligence Graph JSON |
|--------|----------------|------------------------|
| Storage | `patterns` table: `alpha`, `beta`, `confidence` | `graph-state.json` nodes, `ranked-context.json` entries |
| Update model | Beta distribution posterior mean | Direct additive: +0.05 / -0.02 |
| Decay | Hourly alpha decay + inactivity beta increment | 0.005/day for unaccessed nodes > 24h old |
| Floor | alpha >= 0.1, confidence >= 0.0 | confidence >= 0.0 (clamped), node confidence >= 0.05 |
| Scope | Pattern entries only | All entries (memory, patterns, insights) |
| Feedback trigger | `quoth_log_outcome`, `post-task` hook, daemon CONSOLIDATE | `quoth_intelligence_feedback`, `post-task` hook |
| Archival | Yes, when confidence < 0.1 and uses > 5 | No archival mechanism |

### Bridge: post-task Hook

The `post-task` handler is the critical bridge between the two systems. When a subagent completes:

1. `applyFeedback(true)` updates all last-matched intelligence graph entries (+0.05 confidence in JSON)
2. For entries with `pat-` prefixed IDs, extracts the real pattern ID
3. Calls `db.applyBayesianUpdate(patternId, 'success')` on each, updating the SQLite Bayesian scores

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
| `applyHourlyDecay` alpha | SQLite | Down | alpha -= decay_rate * alpha * 0.01 |
| `applyHourlyDecay` Tier 1 | SQLite | Down | beta += 0.1 (never matched, no feedback) |
| `applyHourlyDecay` Tier 2 | SQLite | Down | beta += 0.05 (matched but inactive >7 days) |
| `applyHourlyDecay` Tier 3 | SQLite | Down | beta += 0.15 (inactive >30 days, stacking) |
| `applyFeedback(true)` | JSON graph | Up | +0.05 to matched entries |
| `applyFeedback(false)` | JSON graph | Down | -0.02 to matched entries |
| `consolidateGraph` decay | JSON graph | Down | -0.005/day for unaccessed nodes |
| Search match | SQLite | Neutral | Updates `last_matched_at` only |
