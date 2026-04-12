// tests/integration/end-to-end-productive.test.js
//
// Task 21 / spec §7.2: drive the real `processSessionWithPipeline` against a
// scratch QUOTH_HOME + fake LLMs + in-memory HNSW. Asserts the productive
// path: triage(productive=true) → extract(>=1 entity) → embed → persist →
// archive to done/YYYY-MM-DD/<project>/.
//
// These tests own the end-to-end contract at the spec §2.2 seam. They do
// NOT re-test individual stages (that's what tests/unit/pipeline/ is for) —
// they only check that the orchestrator glues them together and moves the
// session file to the correct bucket.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const H = require_('./_helpers.js')

describe('end-to-end productive session', () => {
  let home
  beforeEach(() => {
    home = H.mkHome('quoth-e2e-prod-')
    process.env.QUOTH_HOME = home
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '10.00'
  })
  afterEach(() => {
    H.rmHome(home)
    delete process.env.QUOTH_HOME
    delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
  })

  it('productive → entities persisted → archived to done/YYYY-MM-DD/<project>/', async () => {
    const { core, ke } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-prod-1')
    const hnsw = H.inMemoryHnsw()
    const llm = H.makeFakeLLMs({
      entities: [
        {
          kind: 'pattern',
          summary: 'use io.Reader for large payloads',
          condition: 'when handling large request bodies',
          action: 'stream via io.Reader instead of ioutil.ReadAll',
          quality_signal: 'domain',
        },
        {
          kind: 'fact',
          summary: 'project uses SQLite WAL mode',
          topic: 'database',
          statement: 'the memory.db is opened with journal_mode=WAL',
          evidence: 'db.js:12',
        },
      ],
    })

    await core.processSessionWithPipeline(sessionFile, { hnsw, llm })

    expect(fs.existsSync(H.donePath(home, 'quoth', 'sess-prod-1'))).toBe(true)
    expect(fs.existsSync(sessionFile)).toBe(false)

    const patterns = ke.searchByKind('pattern', 10)
    const facts = ke.searchByKind('fact', 10)
    expect(patterns).toHaveLength(1)
    expect(facts).toHaveLength(1)
    expect(patterns[0].source).toBe('extracted')
    expect(patterns[0].source_session_id).toBe('sess-prod-1')
    expect(patterns[0].scope).toBe('project:quoth')

    // HNSW received vectors for both entities
    expect(hnsw._dump().size).toBe(2)

    const doneDir = path.dirname(H.donePath(home, 'quoth', 'sess-prod-1'))
    const meta = JSON.parse(fs.readFileSync(path.join(doneDir, 'sess-prod-1.meta.json'), 'utf8'))
    expect(meta.status).toBe('done')
    expect(meta.entity_count).toBe(2)
  })

  it('productive session with zero extract entities still archives to done/', async () => {
    // Spec corner: triage says productive, extract returns []. The pipeline
    // archives as done with entity_count=0 — we trust triage's verdict and
    // record the extraction result faithfully.
    const { core, ke } = H.freshRequire(require_)
    const sessionFile = H.seedProcessing(home, 'sess-prod-empty')
    const llm = H.makeFakeLLMs({ entities: [] })
    const hnsw = H.inMemoryHnsw()

    await core.processSessionWithPipeline(sessionFile, { hnsw, llm })

    expect(fs.existsSync(H.donePath(home, 'quoth', 'sess-prod-empty'))).toBe(true)
    expect(ke.searchByKind('pattern', 10)).toHaveLength(0)
  })
})
