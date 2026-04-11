import { describe, it, expect, vi } from 'vitest'
import {
  runWorkerPool,
  processSessionWithPipeline,
} from '../../../daemon/daemon-core.js'

describe('runWorkerPool', () => {
  it('processes every item exactly once with N workers', async () => {
    const items = Array.from({ length: 20 }, (_, i) => `s${i}`)
    const processed = new Set()
    const pipeline = vi.fn().mockImplementation(async (item) => {
      if (processed.has(item)) throw new Error('double!')
      processed.add(item)
      await new Promise(r => setTimeout(r, 5))
    })
    await runWorkerPool({ items, concurrency: 4, pipeline })
    expect(processed.size).toBe(20)
    expect(pipeline).toHaveBeenCalledTimes(20)
  })

  it('caps in-flight items at `concurrency`', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    await runWorkerPool({
      items,
      concurrency: 3,
      pipeline: async () => {
        active++
        if (active > peak) peak = active
        await new Promise(r => setTimeout(r, 10))
        active--
      },
    })
    expect(peak).toBe(3)
  })

  it('does not halt the pool when one item throws', async () => {
    const items = [1, 2, 3, 4, 5]
    const seen = []
    await runWorkerPool({
      items,
      concurrency: 2,
      pipeline: async (item) => {
        seen.push(item)
        if (item === 3) throw new Error('bad item')
      },
    })
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('processSessionWithPipeline (smoke)', () => {
  it('is a function with the expected arity', () => {
    expect(typeof processSessionWithPipeline).toBe('function')
    expect(processSessionWithPipeline.length).toBeGreaterThanOrEqual(1)
  })
})
