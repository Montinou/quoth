---
name: contextual-bandits
description: Hierarchical Thompson sampling with cluster-level posteriors + 10% exploration + SNIPS counterfactual updates. Use when building retrieval/recommendation systems with implicit feedback that need to balance exploitation with exploration at scale (10k+ items).
---

# Hierarchical Thompson Sampling for Retrieval

## When to use
- Large item catalog (10k+) where per-item Beta(α,β) is infeasible as sole signal
- Context-dependent rewards (item X is great for query type A, bad for type B)
- Implicit feedback only (no explicit labels)
- Need principled exploration to avoid filter bubbles

## Why hierarchical
Per-item LinTS stores O(d²) matrix per arm: 1024d × 100k items ≈ 800GB. Infeasible.

**Hierarchical decomposition:**
1. Group items into K clusters (k-means on embeddings, K ≈ √N)
2. Maintain Beta(α,β) per CLUSTER (O(K) memory)
3. At selection time: Thompson-sample cluster, then rank items within cluster

Memory at 100k items, K=316 clusters: **~5KB** of cluster stats.

## Injection-time algorithm
```
Input: candidates (pre-filtered via HNSW top-N), clusterMap, K=3, queryEmbedding
1. Group candidates by cluster_id
2. For each cluster c: sample s_c ~ Beta(α_c, β_c)
3. Sort clusters by s_c desc
4. From each cluster (top-sampled first), rank items by:
     score = 0.6·cosine(query, item.embedding) + 0.4·(α_i/(α_i+β_i))
5. Take top items until K reached; record cluster+within propensities
```

## Sampling probabilities (propensities)
Critical for counterfactual updates (SNIPS):
```
θ_i ≈ (s_c_i / Σs) × (1 / (rank_within × |cluster|))
clip θ_i ≥ 0.01 to prevent weight explosion
```

## Implementation pitfalls
- **Cluster rebuilds must be gradual** — sudden reassignment wipes learned posteriors
- **K too small** → under-specialization (behaves like global TS)
- **K too large** → data sparsity per cluster, posteriors stay near prior
- **Empty clusters** after k-means → re-seed centroid from lowest-density cluster
- **Cosine + posterior mix (0.6/0.4)** is a hyperparameter; tune with offline eval
- **Normalize embeddings** before clustering (cosine distance assumes unit norm)

## Reference Beta sampling
Marsaglia-Tsang gamma method:
```javascript
function sampleBeta(α, β) {
  const g1 = sampleGamma(α), g2 = sampleGamma(β)
  return g1 / (g1 + g2)
}
```

## Exploration (10% random slot)

**Why:** without exploration, the system converges on whatever was initially popular. Exploration creates clean counterfactual data for unbiased SNIPS updates.

**Mechanism:** with probability ε=0.10, replace one of the K=3 ranked slots with a uniformly random candidate from the pool (excluding already-selected).

```
IF random() < ε:
  slot = random(0, K-1)
  replacement = uniform_random_from(pool - selected)
  selected[slot] = replacement        # mark is_exploration=true
  propensity = ε / |available|
```

**Why this matters for SNIPS:** without exploration, the probability of a random item being picked approaches 0, making SNIPS weights (1/θ) unbounded. Exploration guarantees `θ_i ≥ ε / pool_size`, capping SNIPS weights at `pool_size / ε` ≈ 100-1000.

## Pitfalls of exploration
- **Too high rate (ε > 0.2)** — user experience suffers from irrelevant injections
- **Too low rate (ε < 0.02)** — counterfactual data too sparse for reliable SNIPS
- **Forgetting to mark exploration** — propensity miscomputed → SNIPS biased
- **Drawing from wrong pool** — must exclude already-selected to avoid duplicates

## Propensity logging
At injection time, persist per-slot:
```sql
INSERT INTO injection_log (session_id, pattern_id, cluster_id, rank, propensity, is_exploration, query_text, injected_at)
VALUES (?, ?, ?, ?, ?, ?, ?, now)
```
Critical for offline SNIPS evaluation — DO NOT drop this log.

## SNIPS: Self-Normalized IPS

**Problem:** we log injections with propensities θ_i and observe rewards r_i. Naive IPS `(1/N) Σ r_i / θ_i` has unbounded variance when θ_i is small.

**SNIPS (Swaminathan & Joachims 2015):**
```
r̂(cluster) = Σ_i (w_i · r_i) / Σ_i w_i     where w_i = clip(1/θ_i, cap)
```

Self-normalization removes the bias introduced by clipping. Bounded variance. Production-dominant at Netflix/Spotify.

## SNIPS → Beta posterior update
Given n observations and SNIPS estimate r̂:
```
α_new = α_old + n · r̂
β_new = β_old + n · (1 - r̂)
```
Cap `n ≤ 10` per batch to prevent overshoot from correlated samples.

## Hyperparameters
- **cap = 10**: production standard. cap=1 loses variance reduction; cap=100 amplifies outliers
- **min observations per update = 3**: avoid updating cluster with single noisy sample
- **Look-back window = 7 days**: balance fresh signal vs sample size

## Effective Sample Size (ESS)
```
ESS = (Σw)² / Σw²
```
If ESS << n, weights are concentrated (few observations dominate) → confidence interval wider.

## Pitfalls
- **SNIPS is self-normalized, not strictly unbiased** — for unbiased, use doubly-robust (Dudik et al. 2011)
- **Don't update per-pattern with SNIPS directly** at 100k scale — use cluster-level, rely on within-cluster cosine for item-level differentiation
- **Requires propensity logs** — without logged θ_i, SNIPS is meaningless

## Papers
- Swaminathan & Joachims. *The Self-Normalized Estimator for Counterfactual Learning*, NeurIPS 2015
- Joachims et al. *Unbiased Learning-to-Rank with Biased Feedback*, WSDM 2017
- Dudik, Langford, Li. *Doubly Robust Policy Evaluation and Learning*, ICML 2011
- Hong, Riquelme, Oh, Kveton. *Hierarchical Bayesian Bandits*, 2022
- Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
- Li, Chu, Langford, Schapire. *A Contextual-Bandit Approach to Personalized News*, WWW 2010
