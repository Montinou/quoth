import { describe, it, expect } from 'vitest'

const { computePairwiseSimilarity, bucketPairs, recommendThreshold } = require('../scripts/calibrate-dedup.js')

describe('calibrate-dedup helpers', () => {
  describe('computePairwiseSimilarity', () => {
    it('returns pairs with similarity scores', () => {
      const patterns = [
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: [0.9, 0.1, 0] },
        { id: 'c', embedding: [0, 1, 0] },
      ]
      const pairs = computePairwiseSimilarity(patterns)
      // 3 patterns -> 3 pairs: (a,b), (a,c), (b,c)
      expect(pairs).toHaveLength(3)
      // a-b should be most similar
      const ab = pairs.find(p => (p.idA === 'a' && p.idB === 'b') || (p.idA === 'b' && p.idB === 'a'))
      expect(ab.similarity).toBeGreaterThan(0.9)
      // a-c should be orthogonal
      const ac = pairs.find(p => (p.idA === 'a' && p.idB === 'c') || (p.idA === 'c' && p.idB === 'a'))
      expect(ac.similarity).toBeCloseTo(0, 1)
    })

    it('returns empty array for fewer than 2 patterns', () => {
      expect(computePairwiseSimilarity([])).toEqual([])
      expect(computePairwiseSimilarity([{ id: 'a', embedding: [1, 0] }])).toEqual([])
    })

    it('skips patterns with null embeddings', () => {
      const patterns = [
        { id: 'a', embedding: [1, 0, 0] },
        { id: 'b', embedding: null },
        { id: 'c', embedding: [0.95, 0.05, 0] },
      ]
      const pairs = computePairwiseSimilarity(patterns)
      expect(pairs).toHaveLength(1) // only a-c
    })
  })

  describe('bucketPairs', () => {
    it('groups pairs into similarity buckets', () => {
      const pairs = [
        { idA: 'a', idB: 'b', similarity: 0.86 },
        { idA: 'c', idB: 'd', similarity: 0.89 },
        { idA: 'e', idB: 'f', similarity: 0.93 },
        { idA: 'g', idB: 'h', similarity: 0.75 }, // below range
        { idA: 'i', idB: 'j', similarity: 0.96 }, // above range
      ]
      const buckets = bucketPairs(pairs, 0.85, 0.95)
      expect(buckets['0.85-0.88']).toHaveLength(1)
      expect(buckets['0.88-0.90']).toHaveLength(1)
      expect(buckets['0.92-0.95']).toHaveLength(1)
      // 0.75 and 0.96 are outside the range
      expect(buckets['below']).toHaveLength(1)
      expect(buckets['above']).toHaveLength(1)
    })
  })

  describe('recommendThreshold', () => {
    it('recommends 0.92 when borderline pairs are scarce', () => {
      const buckets = {
        '0.85-0.88': [{ idA: 'a', idB: 'b', similarity: 0.86 }],
        '0.88-0.90': [],
        '0.90-0.92': [],
        '0.92-0.95': [],
      }
      const result = recommendThreshold(buckets)
      expect(result.threshold).toBe(0.92)
      expect(result.reason).toBeTruthy()
    })

    it('recommends lower threshold when many pairs cluster at 0.88-0.92', () => {
      const buckets = {
        '0.85-0.88': [],
        '0.88-0.90': Array(10).fill({ idA: 'x', idB: 'y', similarity: 0.89 }),
        '0.90-0.92': Array(8).fill({ idA: 'x', idB: 'y', similarity: 0.91 }),
        '0.92-0.95': Array(2).fill({ idA: 'x', idB: 'y', similarity: 0.93 }),
      }
      const result = recommendThreshold(buckets)
      // Many pairs at 0.88-0.92 means real dupes live there -> lower threshold
      expect(result.threshold).toBeLessThanOrEqual(0.90)
    })
  })
})
