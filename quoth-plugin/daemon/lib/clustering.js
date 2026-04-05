'use strict'

/**
 * k-means clustering with cosine distance for Float32Array vectors.
 * Enables diversity injection — one pattern per cluster.
 */

function cosineDist(a, b) {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return 1 - dot  // Vectors assumed normalized
}

function assignToCluster(vec, centroids) {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < centroids.length; i++) {
    const d = cosineDist(vec, centroids[i])
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

function meanVector(vectors) {
  if (vectors.length === 0) return null
  const dim = vectors[0].length
  const out = new Float32Array(dim)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i]
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  let norm = 0
  for (let i = 0; i < dim; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) out[i] /= norm
  return out
}

function kmeans(vectors, k, opts = {}) {
  const { maxIter = 30, tol = 1e-4 } = opts
  const effectiveK = Math.min(k, vectors.length)
  if (effectiveK === 0) return { centroids: [], assignments: [] }

  // k-means++ init
  const centroids = [vectors[Math.floor(Math.random() * vectors.length)]]
  while (centroids.length < effectiveK) {
    const dists = vectors.map(v => Math.min(...centroids.map(c => cosineDist(v, c))))
    const sum = dists.reduce((a, b) => a + b, 0)
    let r = Math.random() * sum, idx = 0
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]
      if (r <= 0) { idx = i; break }
    }
    centroids.push(vectors[idx])
  }

  let assignments = new Array(vectors.length).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    const newAssignments = vectors.map(v => assignToCluster(v, centroids))
    let changed = 0
    for (let i = 0; i < assignments.length; i++) {
      if (newAssignments[i] !== assignments[i]) changed++
    }
    assignments = newAssignments
    if (changed / vectors.length < tol) break

    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c)
      if (members.length > 0) centroids[c] = meanVector(members)
    }
  }

  return { centroids, assignments }
}

module.exports = { kmeans, assignToCluster, cosineDist, meanVector }
