<!-- version: 1.1.1 | updated: 2026-04-09 -->

# V2 Subsystems: Bandit-Based Learning Pipeline

The V2 subsystem replaces V1's simple Bayesian update + trigram matching with a hierarchical Thompson sampling bandit, pattern clustering, propensity-scored injection, and counterfactual off-policy evaluation via SNIPS. These components work together to make pattern selection statistically principled: patterns are grouped into clusters, clusters compete via Thompson sampling, injection slots carry propensity scores for debiased reward estimation, and a curation pipeline maintains knowledge base quality.

**Version:** 1.1.1 | **Last updated:** 2026-04-09

Source files:
- `quoth-plugin/daemon/lib/flags.js` -- V2 feature flag infrastructure
- `quoth-plugin/daemon/lib/sampler.js` -- Beta distribution sampling (Marsaglia-Tsang gamma method)
- `quoth-plugin/daemon/lib/bandit-v2.js` -- Hierarchical Thompson sampling and cluster-level selection
- `quoth-plugin/daemon/lib/clustering.js` -- k-means clustering with cosine distance
- `quoth-plugin/daemon/lib/propensity.js` -- Exploration slot and propensity scoring for counterfactual data
- `quoth-plugin/daemon/lib/snips.js` -- Self-Normalized Inverse Propensity Scoring estimator
- `quoth-plugin/daemon/lib/curation.js` -- Quality gates, deduplication, retirement
- `quoth-plugin/daemon/lib/scoring.js` -- Exposure tracking and soft-negative feedback
- `quoth-plugin/daemon/lib/injection.js` -- Injection pipeline combining Thompson sampling + trigram ranking
- `quoth-plugin/daemon/lib/attribution.js` -- Session outcome reward extraction for V2

Related docs:
- [05 -- Daemon Pipeline](./05-daemon-pipeline.md) -- Nightly pipeline phases D-G run V2 components
- [08 -- Confidence Scoring](./08-confidence-scoring.md) -- V1 Bayesian model; V2 feedback paths in "Feedback Sources" section
- [10 -- Local Database](./10-local-database.md) -- SQLite schema including `cluster_stats`, `injection_log` tables

---

## Feature Flags

**File:** `daemon/lib/flags.js`

V2 is gated behind environment variables. A master flag enables all subsystems; individual subflags allow incremental rollout.

| Environment Variable | Controls | Default |
|---------------------|----------|---------|
| `QUOTH_LEARNING_V2` | Master flag -- enables all V2 subsystems | `false` |
| `QUOTH_V2_INJECTION` | Thompson sampling injection, cluster rebuild, SNIPS posteriors | `false` |
| `QUOTH_V2_EXPLORATION` | Exploration slot for counterfactual data generation | `false` |
| `QUOTH_V2_JUDGE` | LLM-as-Judge pairwise comparison batch | `false` |
| `QUOTH_V2_CURATION` | Quality gates, near-duplicate detection, retirement | `false` |

**Resolution logic:** `isSubFlag(name)` returns `true` if either the master flag `QUOTH_LEARNING_V2` is truthy OR the specific subflag `QUOTH_V2_{NAME}` is truthy. Truthy values: `'true'`, `'1'`, `'yes'`.

---

## Thompson Sampling

### Beta Distribution Sampler

**File:** `daemon/lib/sampler.js`

Pure JavaScript implementation with no native dependencies.

| Function | Description |
|----------|-------------|
| `sampleBeta(alpha, beta)` | Draw from Beta(alpha, beta) via ratio of two Gamma samples |
| `sampleGamma(k)` | Marsaglia-Tsang method for Gamma(k, 1); handles k < 1 via rejection |
| `scoreWithThompson(patterns)` | Augment each pattern with `_sampled` drawn from its Beta posterior |

**Minimum parameters:** Alpha and beta are clamped to `Math.max(0.01, value)` to prevent degenerate distributions.

**Pattern fallback:** If a pattern has no `alpha`/`beta` fields, `scoreWithThompson` derives them as `(success_count + 1, failure_count + 1)`, preserving a Beta(1,1) uniform prior for patterns with no history.

### Hierarchical Selection

**File:** `daemon/lib/bandit-v2.js`

Instead of per-pattern Beta posteriors (infeasible at 100k patterns), V2 maintains Beta(alpha, beta) per **cluster**. The selection flow has three stages:

**Stage 1 -- Cluster sampling:** For each cluster containing candidates, draw a Thompson sample from the cluster's Beta posterior. Sort clusters by descending sampled score.

**Stage 2 -- Within-cluster ranking:** For each cluster (in sampled order), rank member patterns by a weighted blend:

```
score = simWeight * cosine(queryEmbedding, patternEmbedding) + postWeight * posteriorMean
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `simWeight` | 0.6 | Weight on embedding cosine similarity to query |
| `postWeight` | 0.4 | Weight on pattern-level posterior mean alpha/(alpha+beta) |

When no query embedding is available, cosine similarity defaults to 0.5.

**Stage 3 -- Slot filling:** Fill K output slots greedily from top-sampled clusters. Each selected pattern receives a propensity score:

```
propensity = clusterProb * withinProb
```

Where:
- `clusterProb = clusterSample / sum(allClusterSamples)` -- normalized probability of selecting this cluster
- `withinProb = max(0.1, 1 / (rank * clusterSize))` -- geometric descending weight within the cluster
- `propensity` is floored at 0.01 to prevent division-by-zero in SNIPS

**Key function:** `hierarchicalSelect(candidates, clusterMap, K, queryEmbedding)` returns `[{ ...pattern, rank, propensity, cluster_id }]`.

---

## Pattern Clustering

**File:** `daemon/lib/clustering.js`

k-means clustering with cosine distance over normalized embedding vectors (Float32Array). Enables diversity in injection -- one pattern per cluster prevents redundant recommendations.

### Algorithm

1. **Initialization:** k-means++ seeding -- pick first centroid randomly, then select subsequent centroids with probability proportional to squared cosine distance from the nearest existing centroid.
2. **Assignment:** Each vector is assigned to the nearest centroid by cosine distance (`1 - dot product` on L2-normalized vectors).
3. **Update:** Recompute centroids as the L2-normalized mean of assigned vectors.
4. **Convergence:** Stop when fewer than `tol` fraction of vectors change assignment, or after `maxIter` iterations.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxIter` | 30 | Maximum iterations |
| `tol` | 1e-4 | Convergence threshold (fraction of vectors that changed) |
| `k` | Capped at `min(k, vectors.length)` | Number of clusters |

**Pattern-aware wrapper:** `clusterPatterns(patterns, K)` accepts pattern objects with `{id, embedding}`, normalizes embeddings to Float32Array, runs k-means, and returns:

```javascript
{
  clusters: [{ id, centroid: number[], memberCount }],
  assignments: [{ patternId, cluster }]
}
```

Requires at least `max(2, K)` valid patterns with embeddings to produce results.

### Daemon Integration

Clusters are rebuilt every 2 hours (V2 mini-pipeline timer) and nightly (Phase D). Results are persisted to the `cluster_stats` table in SQLite with columns for `id`, `alpha`, `beta`, `memberCount`, and centroid data. The cluster posteriors (alpha, beta) are updated by SNIPS estimation from injection logs.

---

## Propensity Scoring

**File:** `daemon/lib/propensity.js`

Generates exploration data for unbiased offline evaluation. With probability epsilon, one injection slot is replaced with a uniformly random candidate from the pool.

| Constant | Value | Description |
|----------|-------|-------------|
| `EXPLORATION_RATE` | 0.10 | Probability of replacing a slot (10%) |

### Exploration Replacement

`replaceWithExploration(selected, pool, rate)`:

1. With probability `1 - rate`, return the original selection unchanged.
2. Pick a random slot index from the selected array.
3. Pick a random candidate from the pool that is not already in the selection.
4. Replace the slot with the exploration candidate, marked with:
   - `is_exploration: true`
   - `propensity = rate / |available|` -- the true probability of this specific item being selected

This propensity formula is critical for SNIPS: it represents the exact probability that the logging policy chose this item, enabling the importance-weighting denominator to debias correctly.

---

## SNIPS Counterfactual Evaluation

**File:** `daemon/lib/snips.js`

Self-Normalized Inverse Propensity Scoring (SNIPS) provides unbiased reward estimation from logged bandit feedback. Reference: Swaminathan & Joachims, "The Self-Normalized Estimator for Counterfactual Learning", NeurIPS 2015.

### Core Estimator

Given observations `[{ reward, propensity }]`:

```
SNIPS = sum(w_i * reward_i) / sum(w_i)
where w_i = min(1/propensity_i, cap)
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `DEFAULT_CAP` | 10 | Maximum importance weight to bound variance |
| Minimum propensity | 1e-6 | Floor to prevent infinite weights |
| Default (no data) | 0.5 | Returned when observations array is empty |

### Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `snipsEstimate(obs, cap)` | `[0, 1]` | Point estimate of expected reward under the current policy |
| `snipsVariance(obs, estimate, cap)` | `[0, 0.25]` | Variance of the SNIPS estimator for confidence intervals |
| `effectiveSampleSize(obs, cap)` | `>= 0` | ESS = (sum w)^2 / sum(w^2); lower ESS means wider confidence intervals |
| `clipWeight(propensity, cap)` | `<= cap` | Clip 1/propensity to cap; floor propensity at 1e-6 |

### Daemon Integration

During nightly Phase E, `updateClusterPosteriors()` reads the last 7 days of `injection_log` entries, computes SNIPS estimates per cluster, and updates each cluster's Beta(alpha, beta) in `cluster_stats`. This closes the learning loop: injection propensities logged during the day feed into nightly posterior updates that change the next day's Thompson sampling distribution.

---

## Attribution

**File:** `daemon/lib/attribution.js`

V2 attribution replaces V1's Jaccard-overlap approach (which conflated correlation with causation) with binary session outcome rewards, refined later by LLM-as-Judge pairwise comparison.

### Session Outcome Reward

`sessionOutcomeReward(events)`:

Three priority tiers are checked in order; the first matching tier determines the reward:

**Priority 1 — `session_summary` event with `success_rate` field:**

| `success_rate` | Reward |
|----------------|--------|
| >= 0.8 | 1.0 |
| >= 0.5 | 0.7 |
| > 0 | 0.3 |
| == 0 | 0.0 |

**Priority 2 — legacy `outcome` fields (backward compat):**

| Condition | Reward |
|-----------|--------|
| Any event with `outcome === 'failure'` or `'error'` | 0.0 |
| Any event with `outcome === 'success'`, no failures | 1.0 |

**Priority 3 — infer from tool mix (fallback):**

| Condition | Reward |
|-----------|--------|
| `Write`/`Edit`/`MultiEdit` calls > 0 AND no Bash errors | 0.8 |
| `Write`/`Edit`/`MultiEdit` calls > 0 AND Bash errors > 0 | 0.5 |
| Bash errors > 0 AND no writes | 0.2 |
| No signal (empty or unknown events) | 0.5 |

### Session Signal Extraction

`extractSessionSignals(events)` builds a compact session summary containing:
- **Tools:** Unique tool names used in the session
- **Files:** File paths extracted via regex (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.md`, `.json`, `.sql`, `.sh`, `.yml`, `.yaml`, `.toml`)
- **Commands:** Base command names from Bash tool calls (path-stripped)

`summarizeSession(events, maxLen=500)` produces a single-line summary for LLM judge prompts: `"Tools: Read, Edit, Bash | Files: src/index.ts | Commands: npm | Outcome: 1.0"`.

---

## Curation

**File:** `daemon/lib/curation.js`

Maintains knowledge base quality through ingestion gates, near-duplicate detection, distinctiveness scoring, and retirement of poor patterns.

### Quality Gate

`passesQualityGate(pattern, opts)` returns `{ pass: boolean, reasons: string[] }`.

| Check | Threshold | Reason |
|-------|-----------|--------|
| Name length | `minNameLen = 25` characters | `'name-too-short'` |
| Generic name | Matches `GENERIC_PATTERNS` regex list (8 patterns) | `'generic-name'` |
| Distinctiveness | `minDistinctiveness = 0.3` | `'low-distinctiveness'` |
| Near-duplicate | `maxSimilarity = 0.85` | `'near-duplicate'` |

**Generic name patterns** (rejected on match):
- `When {verb}ing a file`, `When no specific pattern`, `Use X to Y (file|command|code|files)`
- `Direct {verb}ing without`, `First read the file`, `Always (read|check|verify)`
- `When editing code`, `Default to {verb}ing`

### Distinctiveness Score

`distinctivenessScore(text, commonTokens)` measures the fraction of unique tokens (>= 3 chars) that do NOT appear in the corpus-common set. Higher = more distinctive = worth keeping.

`buildCommonTokens(patterns, topN=1000)` builds the common token set from the top 1000 most frequent tokens across all active patterns.

`backfillDistinctiveness(db)` batch-computes distinctiveness for all active patterns and writes results to the `distinctiveness` column.

### Near-Duplicate Detection

`findNearDuplicates(db, threshold=0.92, maxPairs=100)`:
- O(N^2) pairwise cosine similarity over active pattern embeddings
- Pairs exceeding `threshold` are returned sorted by similarity (descending)
- The pattern with higher confidence is marked as `keep`, the other as `archive`

`enqueueDedupPairs(db, pairs)` inserts pairs into `judge_queue` with priority 0.9 for LLM verification before archival.

### Retirement

`retirePoorPatterns(db, opts)` archives patterns meeting any of these criteria:

| Rule | Condition | Reason |
|------|-----------|--------|
| Low CI upper bound | `attempts >= 20` AND Beta credible interval upper < 0.4 | `'low-ci-upper'` |
| Staleness | Last touched > 90 days ago | `'stale-90d'` |
| Low distinctiveness + stale | `distinctiveness < 0.05` AND last touched > 30 days ago | `'low-distinctiveness'` |

### Daemon Integration

Curation runs during nightly Phase G:
1. `backfillDistinctiveness(db)` -- update scores for all active patterns
2. Weekly (Sunday UTC): `findNearDuplicates()` + `enqueueDedupPairs()` + `retirePoorPatterns()`

---

## Exposure Tracking and Soft-Negative Feedback

**File:** `daemon/lib/scoring.js`

Separates "what was shown to the agent" from "what the agent actually used."

| Constant | Value | Description |
|----------|-------|-------------|
| `SOFT_NEGATIVE_BETA_DELTA` | 0.1 | Beta increment per ignored exposure |
| `MAX_HISTORY` | 20 | Maximum quality history entries per pattern |

### Functions

| Function | Description |
|----------|-------------|
| `recordExposure(db, ids)` | Increment `exposure_count` and update `last_exposed_at` for injected pattern IDs |
| `applySoftNegative(db, ids)` | Increment `beta` by 0.1, increment `ignored_count`, recalculate confidence -- used when patterns are shown but never acted upon |
| `conversionRate(db, id)` | Return `success_count / exposure_count` for a pattern |
| `recordQuality(db, id, score)` | Append a quality observation to `quality_history` JSON (capped at 20 entries) |
| `getTrend(db, id)` | Compute trend from quality history: split into halves, compare means. Returns `'improving'` (delta > 0.05), `'declining'` (delta < -0.05), or `'stable'` |

---

## Injection Pipeline

**File:** `daemon/lib/injection.js`

The injection pipeline combines Thompson sampling with trigram text similarity for pattern selection at query time.

### V1 Path: `rankByThompsonAndTrigram(db, namespace, queryText, limit, opts)`

1. **Thompson pool:** `rankByThompson()` queries active patterns in the namespace (or global) with `confidence >= 0.2`, excluding recently-exposed patterns (within `excludeRecentMinutes = 5`). Pulls a candidate pool of `max(30, limit * 5)` patterns ordered by `RANDOM()` to avoid bias. Each candidate is scored via `scoreWithThompson()` -- a Beta sample drawn from its posterior.
2. **Trigram re-rank:** If query text is available (>= 3 chars), `rankByTrigramSim()` computes Jaccard similarity between query character trigrams and pattern trigrams, re-ranking the Thompson pool by text relevance.
3. **Output:** Top `limit` patterns, ranked by trigram similarity within the Thompson-sampled pool.

### V2 Path: Hierarchical Selection

When the `injection` feature flag is enabled, the injection pipeline switches to the full V2 flow:

1. **Cluster-aware candidate fetch** from the database with namespace filtering
2. **`hierarchicalSelect()`** from `bandit-v2.js` -- Thompson-sample clusters, rank within clusters by embedding similarity + posterior mean, fill K slots with propensity scores
3. **Exploration injection** via `replaceWithExploration()` from `propensity.js` (if `exploration` flag is also set) -- 10% chance of replacing a slot with a random candidate for counterfactual data
4. **Log to `injection_log`** with session ID, pattern IDs, propensities, and `is_exploration` flags
5. **Nightly SNIPS aggregation** reads these logs to update cluster posteriors

### Tag-Filtered Injection

Both V1 and V2 injection paths support tag-based filtering to select patterns relevant to a specific agent role. Tags are propagated from the hook layer through the daemon query server into the injection functions.

**Tag format:** Tags follow an `agent:<type>` convention (e.g., `agent:coder`, `agent:tester`, `agent:reviewer`). Patterns are tagged during distillation or manual curation, stored as a JSON array in the `tags` column of the `patterns` table.

**V1 path (`rankByThompson`):** The `tags` array parameter in `opts` adds SQL `WHERE` clauses to filter the candidate pool before Thompson sampling:

```sql
-- For tags = ['agent:tester']:
WHERE status = 'active'
  AND (namespace = ? OR namespace = 'global')
  AND confidence >= ?
  AND (last_exposed_at IS NULL OR last_exposed_at < ?)
  AND (tags LIKE '%"agent:tester"%')
```

Each tag generates a `tags LIKE ?` clause with the pattern `%"<tag>"%`, performing a JSON-array-contains check against the serialized `tags` column. Multiple tags are joined with `OR` (any tag matches).

**V2 path (`query-server.js`):** The `tags` array from the request body is forwarded to `db.searchBySimilarity(embedding, 20, tags)` for the hierarchical selection path. The same tags are also passed through to `rankByThompsonAndTrigram()` in the V1 fallback path within `handleQuery()`.

**Hook integration:** The `subagent-start` handler in `hook-dispatch.js` extracts `hookInput.agent_type`, converts it to `['agent:<type>']` format, and passes it as the `tags` parameter in the `queryDaemon()` call. If tagged results return fewer than 2 patterns, the handler retries without tags as a fallback.

### Trigram Implementation

| Function | Description |
|----------|-------------|
| `tokenize(text)` | Lowercase, strip non-alphanumeric, split on whitespace, filter tokens >= 2 chars |
| `trigrams(text)` | Generate character-level trigram set from tokenized text |
| `jaccardSim(a, b)` | Jaccard similarity: `|intersection| / |union|` over trigram sets |

---

## Integration: How V2 Components Interact

The V2 subsystems form a closed-loop learning system across two timescales:

### Real-Time (per injection)

```
Query arrives
  -> injection.js: rankByThompson (V1) or hierarchicalSelect (V2)
  -> propensity.js: optionally inject exploration slot
  -> scoring.js: recordExposure for all selected patterns
  -> Log to injection_log: {session, pattern_id, propensity, is_exploration}
```

### Nightly (daemon pipeline Phases D-G)

```
Phase D: clustering.js -> rebuildClusters()
  k-means over active pattern embeddings, persist to cluster_stats

Phase E: snips.js -> updateClusterPosteriors()
  Read 7 days of injection_log + outcomes
  Compute SNIPS estimate per cluster
  Update cluster Beta(alpha, beta) in cluster_stats

Phase F: bandit-v2.js (via judge batch)
  Pairwise LLM-as-Judge on high-uncertainty cluster pairs
  Refines cluster posteriors beyond what SNIPS alone provides

Phase G: curation.js
  backfillDistinctiveness -> findNearDuplicates -> retirePoorPatterns
  Prune low-quality patterns to maintain signal-to-noise
```

### Feedback Loop

```
Day 1: Patterns injected with propensity P -> logged
Day 1: Session completes -> attribution.js computes reward {0.0, 0.2, 0.3, 0.5, 0.7, 0.8, 1.0}
Day 1: scoring.js records exposure, applies soft-negative if ignored
Night: SNIPS uses (reward, propensity) pairs to estimate cluster value
Night: Cluster posteriors updated -> next day's Thompson sampling changes
Day 2: Better clusters sampled more often -> better patterns surfaced
```

This creates a self-improving cycle: the system explores (via propensity slots), measures impact (via SNIPS debiasing), and adapts (via cluster posterior updates) -- all without requiring explicit user feedback.
