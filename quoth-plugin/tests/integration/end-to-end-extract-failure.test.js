// tests/integration/end-to-end-extract-failure.test.js
//
// Task 21 / spec §7.2: when the primary extract LLM (Kimi) throws, the
// pipeline must route through `runExtractWithFallback` and retry against
// the Sonnet fallback. A recovered session still lands in done/ with its
// entities stamped source='extracted' and the session_id propagated.
//
// Why the test exists: Task 21 shipped with the primary source-stamping
// fix applied to `runExtract`, but `runExtractWithFallback` (daemon-core
// wires this path today) had its own entity-shaping loop that forgot to
// stamp `source` + `source_session_id`. Without stamping, persist.js
// throws on the NOT NULL constraint and the session is wrongly archived
// as error/. This test pins the fixed behavior.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('./_helpers.js')

describe('end-to-end extract-failure fallback', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-e2e-extract-fail-')
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '10.00'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  it('primary Kimi throws → Sonnet fallback recovers → done/ with source stamped', async () => {
    const { core, ke, db } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-fallback-1', { project: 'proj-fb' })

    let kimiCalls = 0
    let sonnetCalls = 0
    const llm = {
      gemini: async () => ({
        text: JSON.stringify({ productive: true, urgency: 'medium', suspected_kinds: ['pattern'] }),
        cost_usd: 0.0001,
      }),
      kimi: async () => {
        kimiCalls++
        throw new Error('kimi exploded: upstream 500')
      },
      sonnet: async () => {
        sonnetCalls++
        return {
          text: JSON.stringify({
            entities: [
              {
                kind: 'pattern',
                summary: 'rescued-by-sonnet',
                condition: 'when primary fails',
                action: 'retry via sonnet',
              },
            ],
          }),
          cost_usd: 0.02,
        }
      },
    }

    await core.processSessionWithPipeline(sessionFile, { hnsw: H.inMemoryHnsw(), llm })

    expect(kimiCalls).toBeGreaterThanOrEqual(1)
    expect(sonnetCalls).toBe(1)

    // Session ended up in done/, not error/.
    expect(fs.existsSync(H.donePath(home, 'proj-fb', 'sess-fallback-1'))).toBe(true)
    expect(fs.existsSync(H.errorPath(home, 'sess-fallback-1'))).toBe(false)

    // Persisted entity has the authoritative stamps. This is the bug fix:
    // without source='extracted' the SQL insert would have thrown.
    const rows = ke.searchByKind('pattern', 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('extracted')
    expect(rows[0].source_session_id).toBe('sess-fallback-1')
    expect(rows[0].scope).toBe('project:proj-fb')

    // A pipeline_errors row was logged at severity='degraded' noting recovery.
    const row = db.prepare(
      `SELECT stage, severity, resolution FROM pipeline_errors
       WHERE stage='extract' AND resolution='recovered' ORDER BY id DESC LIMIT 1`,
    ).get()
    expect(row).toBeTruthy()
    expect(row.severity).toBe('degraded')
  })
})
