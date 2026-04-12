// tests/integration/end-to-end-routine.test.js
//
// Task 21 / spec §7.2: a session that triage marks productive=false must
// short-circuit BEFORE extract ever runs, be archived to
// `routine/YYYY-MM-DD/<project>/`, and leave the sidecar with
// `status='routine'` + `triage_reason` stamped from the LLM response.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('./_helpers.js')

describe('end-to-end routine session', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-e2e-routine-')
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '10.00'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  it('triage productive=false → routine bucket, extract never called', async () => {
    const { core, ke } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-routine-1')
    const hnsw = H.inMemoryHnsw()

    let extractCalls = 0
    const llm = {
      gemini: async () => ({
        text: JSON.stringify({
          productive: false,
          urgency: 'low',
          suspected_kinds: [],
          reason: 'readme_navigation',
        }),
        cost_usd: 0.0001,
      }),
      kimi: async () => {
        extractCalls++
        return { text: '{"entities":[]}', cost_usd: 0 }
      },
    }

    await core.processSessionWithPipeline(sessionFile, { hnsw, llm })

    expect(extractCalls).toBe(0)
    expect(fs.existsSync(H.routinePath(home, 'quoth', 'sess-routine-1'))).toBe(true)
    expect(fs.existsSync(sessionFile)).toBe(false)

    const routineDir = path.dirname(H.routinePath(home, 'quoth', 'sess-routine-1'))
    const meta = JSON.parse(fs.readFileSync(path.join(routineDir, 'sess-routine-1.meta.json'), 'utf8'))
    expect(meta.status).toBe('routine')
    expect(meta.session_type).toBe('routine')

    // No entities persisted — the DB should be empty for every kind.
    expect(ke.searchByKind('pattern', 10)).toHaveLength(0)
    expect(ke.searchByKind('fact', 10)).toHaveLength(0)
  })

  it('zero tool_use entries → empty bucket, triage never called', async () => {
    // Spec §2.2: sessions with zero tool_use entries are archived as `empty`
    // before any LLM spend. We assert that by counting LLM calls.
    const { core } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-empty-1', {
      lines: [
        { event: 'session_start', session: 'sess-empty-1' },
      ],
    })
    let geminiCalls = 0
    const llm = {
      gemini: async () => { geminiCalls++; return { text: '{"productive":true}', cost_usd: 0 } },
      kimi: async () => ({ text: '{"entities":[]}', cost_usd: 0 }),
    }

    await core.processSessionWithPipeline(sessionFile, { hnsw: H.inMemoryHnsw(), llm })

    expect(geminiCalls).toBe(0)
    const emptyDir = path.join(home, 'trajectories', 'empty', H.todayDate())
    expect(fs.existsSync(path.join(emptyDir, 'sess-empty-1.jsonl'))).toBe(true)
  })
})
