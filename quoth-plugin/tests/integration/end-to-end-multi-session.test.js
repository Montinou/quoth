// tests/integration/end-to-end-multi-session.test.js
//
// Task 21 / spec §7.2: feed N sessions through the pipeline sequentially
// and assert each one lands in exactly one terminal bucket with no loss
// and no duplication. Also covers the cross-session invariant that the
// embedding of the same content-hash collapses to a single row (spec §3.1
// `id = sha1(kind + content)[:16]`) and increments alpha on subsequent
// sessions thanks to the persist.js upsert logic.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('./_helpers.js')

describe('end-to-end multi-session pipeline', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-e2e-multi-')
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '10.00'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  it('processes 3 productive sessions in sequence, no file loss', async () => {
    const { core, ke } = H.freshRequire(require_)
    const hnsw = H.inMemoryHnsw()

    const sids = ['m1', 'm2', 'm3']
    const files = sids.map(sid => H.seedProcessing(home, sid, { project: 'proj-a' }))
    for (let i = 0; i < sids.length; i++) {
      const llm = H.makeFakeLLMs({
        entities: [{
          kind: 'pattern',
          summary: `pattern-${i}`,
          condition: `cond-${i}`,
          action: `act-${i}`,
        }],
      })
      await core.processSessionWithPipeline(files[i], { hnsw, llm })
    }

    for (const sid of sids) {
      expect(fs.existsSync(H.donePath(home, 'proj-a', sid))).toBe(true)
    }
    // None should be left in processing/.
    const leftovers = fs.readdirSync(`${home}/trajectories/processing`).filter(f => f.endsWith('.jsonl'))
    expect(leftovers).toEqual([])

    // Each session produced a distinct entity (different content).
    expect(ke.searchByKind('pattern', 20)).toHaveLength(3)
  })

  it('same content across 2 sessions → single row, alpha incremented', async () => {
    const { core, ke } = H.freshRequire(require_)
    const hnsw = H.inMemoryHnsw()

    const entity = {
      kind: 'pattern',
      summary: 'idempotent upsert',
      condition: 'when the same pattern is rediscovered',
      action: 'increment alpha instead of inserting a duplicate row',
    }

    // First session
    const f1 = H.seedProcessing(home, 'dup-1')
    await core.processSessionWithPipeline(f1, {
      hnsw, llm: H.makeFakeLLMs({ entities: [entity] }),
    })
    const rows1 = ke.searchByKind('pattern', 10)
    expect(rows1).toHaveLength(1)
    const alpha1 = rows1[0].alpha

    // Second session emits the same entity content → persist.js upsert
    // sees a different source_session_id and increments alpha.
    const f2 = H.seedProcessing(home, 'dup-2')
    await core.processSessionWithPipeline(f2, {
      hnsw, llm: H.makeFakeLLMs({ entities: [entity] }),
    })
    const rows2 = ke.searchByKind('pattern', 10)
    expect(rows2).toHaveLength(1)
    expect(rows2[0].alpha).toBe(alpha1 + 1)
  })
})
