import { describe, it, expect } from 'vitest'
import { clusterPatterns, assignToCluster } from '../daemon/lib/clustering.js'

describe('clusterPatterns (pattern-aware wrapper)', () => {
  it('clusters n=100 4-dim embeddings into K=5', () => {
    const patterns = []
    let seed = 1
    const rand = () => { seed = (seed*9301+49297) % 233280; return seed/233280 }
    for (let c = 0; c < 5; c++) {
      const center = [rand(), rand(), rand(), rand()]
      for (let i = 0; i < 20; i++) {
        patterns.push({
          id: `p-${c}-${i}`,
          embedding: center.map(x => x + (rand()-0.5)*0.05),
        })
      }
    }
    const result = clusterPatterns(patterns, 5, { maxIter: 30 })
    expect(result.clusters).toHaveLength(5)
    expect(result.assignments).toHaveLength(100)
    // Top cluster has at least 10 members (well-separated clusters usually >=20)
    const maxCount = Math.max(...result.clusters.map(c => c.memberCount))
    expect(maxCount).toBeGreaterThan(10)
  })

  it('returns empty clusters when too few patterns', () => {
    const r = clusterPatterns([{id:'a', embedding:[1,0]}], 5)
    expect(r.clusters).toHaveLength(0)
  })

  it('filters patterns without embeddings', () => {
    const patterns = [
      { id: 'a', embedding: [1, 0, 0] },
      { id: 'b', embedding: [0, 1, 0] },
      { id: 'c', embedding: null },
      { id: 'd', embedding: [0, 0, 1] },
    ]
    const r = clusterPatterns(patterns, 2)
    expect(r.assignments).toHaveLength(3)  // c excluded
  })

  it('assignToCluster finds nearest centroid', () => {
    const centroids = [new Float32Array([1,0,0]), new Float32Array([0,1,0])]
    const query = new Float32Array([0.9, 0.1, 0])
    const norm = Math.sqrt(0.9*0.9 + 0.1*0.1)
    for (let i = 0; i < 3; i++) query[i] /= norm
    expect(assignToCluster(query, centroids)).toBe(0)
  })
})
