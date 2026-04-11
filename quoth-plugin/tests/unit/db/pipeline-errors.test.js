import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('pipeline_errors schema (expanded)', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'quoth-pe-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('has all severity-capable columns', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const cols = openDb().prepare(`PRAGMA table_info(pipeline_errors)`).all().map(c => c.name)
    for (const c of ['severity','worker_id','context','model_attempted','fallback_attempted','fallback_succeeded','retry_count','resolution']) {
      expect(cols).toContain(c)
    }
  })

  it('logPipelineError writes a row with severity', async () => {
    const { openDb, logPipelineError } = await import('../../../daemon/db.js')
    logPipelineError({ stage: 'triage', severity: 'degraded', error_message: 'cold start' })
    const rows = openDb().prepare(`SELECT * FROM pipeline_errors WHERE stage='triage'`).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('degraded')
  })
})
