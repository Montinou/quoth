import { describe, it, expect } from 'vitest'
import { Semaphore } from '../../../daemon/lib/semaphore.js'

describe('Semaphore', () => {
  it('caps concurrency at max', async () => {
    const s = new Semaphore(3)
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 10 }, () =>
      s.run(async () => {
        active++
        if (active > peak) peak = active
        await new Promise(r => setTimeout(r, 20))
        active--
      }),
    )
    await Promise.all(tasks)
    expect(peak).toBe(3)
  })

  it('propagates return value', async () => {
    const s = new Semaphore(1)
    const result = await s.run(async () => 42)
    expect(result).toBe(42)
  })

  it('releases slot on exception', async () => {
    const s = new Semaphore(1)
    await expect(s.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // If the slot leaked, this next call would hang.
    const result = await s.run(async () => 'ok')
    expect(result).toBe('ok')
  })
})
