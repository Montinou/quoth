import { describe, it, expect } from 'vitest'
const { kmeans, assignToCluster, cosineDist } = require('../daemon/lib/clustering.js')

function mkVec(len, seed) {
  const v = new Float32Array(len)
  for (let i = 0; i < len; i++) v[i] = Math.sin(seed * (i + 1))
  let norm = 0
  for (let i = 0; i < len; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < len; i++) v[i] /= norm
  return v
}

describe('k-means clustering', () => {
  it('produces requested number of clusters', () => {
    const vectors = Array.from({ length: 100 }, (_, i) => mkVec(32, i + 1))
    const { centroids, assignments } = kmeans(vectors, 10, { maxIter: 20 })
    expect(centroids.length).toBe(10)
    expect(assignments.length).toBe(100)
    expect(Math.max(...assignments)).toBeLessThan(10)
  })

  it('caps k at vector count', () => {
    const vectors = Array.from({ length: 5 }, (_, i) => mkVec(16, i + 1))
    const { centroids } = kmeans(vectors, 50, { maxIter: 10 })
    expect(centroids.length).toBeLessThanOrEqual(5)
  })

  it('assignToCluster returns nearest centroid index', () => {
    const c1 = mkVec(8, 1)
    const c2 = mkVec(8, 100)
    const query = mkVec(8, 1.01)
    const idx = assignToCluster(query, [c1, c2])
    expect(idx).toBe(0)
  })

  it('cosineDist is ~0 for identical vectors', () => {
    const v = mkVec(8, 1)
    expect(cosineDist(v, v)).toBeLessThan(0.01)
  })
})
