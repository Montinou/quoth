import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @xenova/transformers before requiring embed.js
vi.mock('@xenova/transformers', () => {
  const DIMS = 384
  const mockPipeline = vi.fn(async (texts, _opts) => {
    // Simulate batch: if texts is an array, return flat array of embeddings
    const items = Array.isArray(texts) ? texts : [texts]
    const data = new Float32Array(items.length * DIMS)
    for (let i = 0; i < items.length; i++) {
      // Fill with deterministic values based on text hash
      const seed = items[i].length
      for (let j = 0; j < DIMS; j++) {
        data[i * DIMS + j] = ((seed + j) % 100) / 100
      }
    }
    return { data }
  })

  return {
    pipeline: vi.fn(async () => mockPipeline)
  }
})

let embed

beforeEach(() => {
  // Clear module cache to reset singleton state
  vi.resetModules()
  embed = require('../daemon/lib/embed.js')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generateEmbeddingBatch', () => {
  it('returns embeddings for multiple texts in one call', async () => {
    const results = await embed.generateEmbeddingBatch(['hello world', 'test text', 'another one'])
    expect(results).toHaveLength(3)
    expect(results[0]).toHaveLength(384)
    expect(results[1]).toHaveLength(384)
    expect(results[2]).toHaveLength(384)
  })

  it('returns null for empty strings in the batch', async () => {
    const results = await embed.generateEmbeddingBatch(['valid text', '', '  ', 'also valid'])
    expect(results).toHaveLength(4)
    expect(results[0]).toHaveLength(384)
    expect(results[1]).toBeNull()
    expect(results[2]).toBeNull()
    expect(results[3]).toHaveLength(384)
  })

  it('returns empty array for empty input', async () => {
    const results = await embed.generateEmbeddingBatch([])
    expect(results).toEqual([])
  })

  it('returns all nulls for all-empty input', async () => {
    const results = await embed.generateEmbeddingBatch(['', '', ''])
    expect(results).toEqual([null, null, null])
  })

  it('handles null/undefined texts gracefully', async () => {
    const results = await embed.generateEmbeddingBatch([null, undefined, 'valid'])
    expect(results).toHaveLength(3)
    expect(results[0]).toBeNull()
    expect(results[1]).toBeNull()
    expect(results[2]).toHaveLength(384)
  })
})

describe('generateEmbedding (single)', () => {
  it('returns 384-dim vector for valid text', async () => {
    const result = await embed.generateEmbedding('hello world')
    expect(result).toHaveLength(384)
  })

  it('returns null for empty text', async () => {
    const result = await embed.generateEmbedding('')
    expect(result).toBeNull()
  })

  it('returns null for null input', async () => {
    const result = await embed.generateEmbedding(null)
    expect(result).toBeNull()
  })
})

describe('constants', () => {
  it('exports correct dimensions', () => {
    expect(embed.DIMENSIONS).toBe(384)
  })

  it('exports model name', () => {
    expect(embed.MODEL_NAME).toBe('Xenova/all-MiniLM-L6-v2')
  })
})
