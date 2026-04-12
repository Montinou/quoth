// tests/unit/db/schema-bootstrap.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('knowledge_entities schema', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'quoth-schema-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('creates knowledge_entities with required columns', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const cols = db.prepare(`PRAGMA table_info(knowledge_entities)`).all()
    const names = cols.map(c => c.name)
    for (const col of ['id','kind','scope','summary','content','metadata','embedding','tags','confidence','alpha','beta','polarity','status','source','source_session_id','created_at','updated_at','last_exposed_at','exposure_count','embedding_indexed']) {
      expect(names).toContain(col)
    }
  })

  it('creates llm_budget table', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const cols = db.prepare(`PRAGMA table_info(llm_budget)`).all()
    expect(cols.map(c => c.name)).toEqual(
      expect.arrayContaining(['date','spend_usd','triage_calls','extract_calls','updated_at'])
    )
  })

  it('creates expected indexes on knowledge_entities', async () => {
    const { openDb } = await import('../../../daemon/db.js')
    const db = openDb()
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='knowledge_entities'`).all().map(r => r.name)
    for (const name of ['idx_ke_kind','idx_ke_scope','idx_ke_kind_scope','idx_ke_session','idx_ke_created','idx_ke_confidence']) {
      expect(idx).toContain(name)
    }
  })
})
