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

## Papers
- Hong, Riquelme, Oh, Kveton. *Hierarchical Bayesian Bandits*, 2022
- Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
- Li, Chu, Langford, Schapire. *A Contextual-Bandit Approach to Personalized News*, WWW 2010
