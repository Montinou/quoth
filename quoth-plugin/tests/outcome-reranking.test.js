import { describe, it, expect } from 'vitest'

const { rerankByOutcomes } = require('../daemon/lib/query-server.js')

describe('rerankByOutcomes', () => {
  it('boosts pattern with similar successful outcome', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[0] = 0.99
    intentEmbedding[1] = 0.05

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
      { id: 'pat-B', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'success' },
      ],
      'pat-B': [], // no outcomes
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)

    // pat-A should be boosted (similar intention + success)
    const scoreA = result.find(p => p.id === 'pat-A')._outcomeScore
    const scoreB = result.find(p => p.id === 'pat-B')._outcomeScore
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  it('penalizes pattern with similar failed outcome', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[0] = 0.98

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
      { id: 'pat-B', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'failure' },
      ],
      'pat-B': [],
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)

    const scoreA = result.find(p => p.id === 'pat-A')._outcomeScore
    const scoreB = result.find(p => p.id === 'pat-B')._outcomeScore
    expect(scoreA).toBeLessThan(scoreB)
  })

  it('returns neutral score when no similar outcomes exist', () => {
    const queryEmbedding = Array(384).fill(0)
    queryEmbedding[0] = 1.0

    // Orthogonal intention
    const intentEmbedding = Array(384).fill(0)
    intentEmbedding[100] = 1.0

    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
    ]

    const outcomes = {
      'pat-A': [
        { intention_embedding: JSON.stringify(intentEmbedding), outcome: 'success' },
      ],
    }

    const result = rerankByOutcomes(patterns, queryEmbedding, outcomes)
    // Orthogonal intention → neutral (0.0 adjustment)
    expect(result[0]._outcomeScore).toBeCloseTo(0, 1)
  })

  it('handles patterns with no outcome data', () => {
    const patterns = [
      { id: 'pat-A', confidence: 0.6, _score: 0.5 },
    ]

    const result = rerankByOutcomes(patterns, Array(384).fill(0.1), {})
    expect(result).toHaveLength(1)
    expect(result[0]._outcomeScore).toBe(0)
  })
})
