// tests/integration/end-to-end-budget-exhausted.test.js
//
// Task 21 / spec §7.2: the daily LLM budget is a hard gate. When triage's
// reservation fails, it returns the safe default (productive=true with
// degraded=true) and the pipeline continues into extract, where the next
// reservation fails for the same reason — yielding zero entities but a
// successful archive to done/. Budget exhaustion must NOT error-archive
// (the session content is fine; we simply had no budget to analyze it).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('./_helpers.js')

describe('end-to-end budget-exhausted session', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-e2e-budget-')
    process.env.QUOTH_HOME = home
    // Microscopic cap — the first triage reservation already exceeds it.
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '0.0000001'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  it('triage budget-exhausted → safe default → extract budget-exhausted → done/, 0 entities', async () => {
    const { core, ke, db } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-budget-1')

    let geminiCalls = 0
    let kimiCalls = 0
    const llm = {
      gemini: async () => { geminiCalls++; return { text: '{"productive":true}', cost_usd: 0 } },
      kimi: async () => { kimiCalls++; return { text: '{"entities":[]}', cost_usd: 0 } },
    }

    await core.processSessionWithPipeline(sessionFile, { hnsw: H.inMemoryHnsw(), llm })

    // Neither LLM should have been called — both reservations rejected upfront.
    expect(geminiCalls).toBe(0)
    expect(kimiCalls).toBe(0)

    expect(fs.existsSync(H.donePath(home, 'quoth', 'sess-budget-1'))).toBe(true)
    expect(ke.searchByKind('pattern', 10)).toHaveLength(0)

    // A pipeline_errors row with severity='warn' and stage='budget' was logged.
    const row = db.prepare(
      `SELECT stage, severity FROM pipeline_errors WHERE stage='budget' ORDER BY id DESC LIMIT 1`,
    ).get()
    expect(row).toBeTruthy()
    expect(row.severity).toBe('warn')
  })
})
