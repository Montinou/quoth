import { describe, it, expect } from 'vitest'
import { scoreCluster, scoreWithinCluster, hierarchicalSelect, cosineSim } from '../daemon/lib/bandit-v2.js'

describe('hierarchical Thompson sampling', () => {
  it('scoreCluster prefers high-alpha clusters', () => {
    const clusters = [
      { id: 0, alpha: 20, beta: 1 },   // high success
      { id: 1, alpha: 1, beta: 20 },   // high failure
    ]
    const wins = [0, 0]
    for (let i = 0; i < 2000; i++) wins[scoreCluster(clusters)]++
    expect(wins[0]).toBeGreaterThan(1800)
  })

  it('scoreWithinCluster sorts by blend of similarity + posterior', () => {
    const patterns = [
      { id:'a', alpha:5, beta:1, embedding: [1,0,0] },   // high conf, close to query
      { id:'b', alpha:1, beta:5, embedding: [1,0,0] },   // low conf, close to query
      { id:'c', alpha:5, beta:1, embedding: [0,1,0] },   // high conf, far from query
    ]
    const ranked = scoreWithinCluster(patterns, [1,0,0])
    expect(ranked[0].id).toBe('a')
  })

  it('hierarchicalSelect returns K items with propensities', () => {
    const candidates = [
      { id:'a', cluster_id:0, alpha:5, beta:1, embedding:[1,0] },
      { id:'b', cluster_id:0, alpha:3, beta:2, embedding:[0.9,0.1] },
      { id:'c', cluster_id:1, alpha:1, beta:1, embedding:[0,1] },
    ]
    const map = new Map([[0,{alpha:10,beta:1}], [1,{alpha:1,beta:10}]])
    const selected = hierarchicalSelect(candidates, map, 2, [1,0])
    expect(selected).toHaveLength(2)
    expect(selected.every(s => s.propensity > 0 && s.propensity <= 1)).toBe(true)
    expect(selected[0].rank).toBe(1)
    expect(selected[1].rank).toBe(2)
  })

  it('hierarchicalSelect handles empty candidates', () => {
    expect(hierarchicalSelect([], new Map(), 3)).toEqual([])
  })

  it('cosineSim returns 1 for identical vectors', () => {
    expect(cosineSim([1,0,0], [1,0,0])).toBeCloseTo(1, 5)
    expect(cosineSim([1,0,0], [0,1,0])).toBeCloseTo(0, 5)
  })
})
