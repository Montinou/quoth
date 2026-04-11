import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('llm-budget reservation', () => {
  let home, budget
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-bud-'))
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '0.005'
    vi.resetModules()
    budget = await import('../../../daemon/lib/llm-budget.js')
  })
  afterEach(() => { delete process.env.QUOTH_DAILY_LLM_BUDGET_USD; rmSync(home, { recursive: true, force: true }) })

  it('reserves then reconciles a spend', async () => {
    const r = budget.reserve({ stage: 'triage', estimated_usd: 0.001 })
    expect(r.ok).toBe(true)
    budget.reconcile({ stage: 'triage', estimated_usd: 0.001, actual_usd: 0.0008 })
    const today = budget.today()
    expect(today.spend_usd).toBeCloseTo(0.0008, 6)
  })

  it('rejects reservation when over cap', () => {
    const a = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    const b = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    const c = budget.reserve({ stage: 'extract', estimated_usd: 0.003 })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false) // 0.003 + 0.003 = 0.006 > 0.005 cap
    expect(c.ok).toBe(false)
  })

  it('4-parallel reservations against cap=$0.005 cost=$0.002 yield exactly 2 successes', async () => {
    const results = await Promise.all([1,2,3,4].map(() => Promise.resolve(budget.reserve({ stage: 'triage', estimated_usd: 0.002 }))))
    const ok = results.filter(r => r.ok).length
    expect(ok).toBe(2)
  })
})
