'use strict'

/**
 * Hierarchical Thompson Sampling for pattern retrieval (v2).
 *
 * Instead of per-pattern Beta posteriors (infeasible at 100k scale),
 * maintains Beta(α,β) per cluster. Selection flow:
 *   1. Sample cluster scores from cluster-level posteriors
 *   2. For each cluster (top-sampled first), rank candidates within
 *      by embedding cosine + per-pattern confidence
 *   3. Emit top-K with per-slot propensity = P(cluster picked) × P(item ranked).
 *
 * References:
 *   - Hong et al. *Hierarchical Bayesian Bandits*, 2022
 *   - Agrawal & Goyal. *Thompson Sampling for Contextual Bandits*, ICML 2013
 */

const { sampleBeta } = require('./sampler.js')

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na*nb) : 0
}

function parseEmbedding(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * Rank a cluster's members by a blend of embedding similarity + posterior mean.
 */
function scoreWithinCluster(patterns, queryEmbedding, opts = {}) {
  const { simWeight = 0.6, postWeight = 0.4 } = opts
  for (const p of patterns) {
    const embed = parseEmbedding(p.embedding)
    const cosine = queryEmbedding && embed ? cosineSim(queryEmbedding, embed) : 0.5
    const alpha = p.alpha ?? 1, beta = p.beta ?? 1
    const posteriorMean = alpha / (alpha + beta)
    p._score = simWeight * cosine + postWeight * posteriorMean
  }
  patterns.sort((a, b) => b._score - a._score)
  return patterns
}

/**
 * Pick one cluster via Thompson sampling over cluster-level Beta posteriors.
 * Returns the cluster_id with the highest sampled score.
 */
function scoreCluster(clusters) {
  if (!clusters || clusters.length === 0) return null
  let bestId = clusters[0].id, bestScore = -1
  for (const c of clusters) {
    const s = sampleBeta(c.alpha, c.beta)
    if (s > bestScore) { bestScore = s; bestId = c.id }
  }
  return bestId
}

/**
 * Hierarchical selection: group candidates by cluster, sample cluster order,
 * fill K slots from top-sampled clusters preferentially.
 *
 * clusterMap: Map<cluster_id, { alpha, beta, memberCount }>
 * Returns: [{ ...pattern, rank, propensity, cluster_id }]
 */
function hierarchicalSelect(candidates, clusterMap, K, queryEmbedding) {
  if (!candidates || candidates.length === 0) return []
  // 1. Group candidates by cluster
  const byCluster = new Map()
  for (const p of candidates) {
    const cid = p.cluster_id ?? -1
    if (!byCluster.has(cid)) byCluster.set(cid, [])
    byCluster.get(cid).push(p)
  }

  // 2. Thompson-sample each cluster's Beta
  const clusterList = [...byCluster.keys()].map(cid => {
    const stats = clusterMap instanceof Map ? clusterMap.get(cid) : clusterMap?.[cid]
    return {
      id: cid,
      alpha: stats?.alpha ?? 1,
      beta: stats?.beta ?? 1,
      members: byCluster.get(cid),
    }
  })
  for (const c of clusterList) c._sample = sampleBeta(c.alpha, c.beta)
  clusterList.sort((a, b) => b._sample - a._sample)

  const sumSamples = clusterList.reduce((s, c) => s + c._sample, 0) || 1

  // 3. Fill K slots greedily from top-sampled clusters
  const selected = []
  for (const c of clusterList) {
    if (selected.length >= K) break
    const ranked = scoreWithinCluster(c.members, queryEmbedding)
    const clusterProb = c._sample / sumSamples
    const take = Math.min(ranked.length, K - selected.length)
    for (let i = 0; i < take; i++) {
      const p = ranked[i]
      // Approximate within-cluster propensity as geometric descending weight
      const withinProb = Math.max(0.1, 1 / (i + 1) / ranked.length)
      const propensity = Math.max(0.01, clusterProb * withinProb)
      selected.push({ ...p, rank: selected.length + 1, propensity, cluster_id: c.id })
    }
  }
  return selected
}

module.exports = { sampleBeta, scoreCluster, scoreWithinCluster, hierarchicalSelect, cosineSim, parseEmbedding }
