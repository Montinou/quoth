import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
const { createDb } = require('../daemon/db.js')

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-memory-test-'))
  const dbPath = path.join(dir, 'memory.db')
  const db = createDb(dbPath)
  db.initHnsw()
  return { db, dir }
}

describe('upsertMemoryEntry', () => {
  it('inserts a new fact row', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({
      namespace: 'quoth',
      key: 'moonshot_reasoning_input_rejected',
      content: 'Moonshot API rejects reasoning_content when passed in assistant input messages.',
      type: 'fact',
      tags: ['moonshot', 'api'],
      metadata: { evidence: '400 response from Kimi K2.5 tool loop', scope: 'global' },
    })
    const rows = db.prepare('SELECT * FROM memory_entries WHERE namespace = ? AND key = ?').all('quoth', 'moonshot_reasoning_input_rejected')
    expect(rows.length).toBe(1)
    expect(rows[0].content).toMatch(/reasoning_content/)
    expect(rows[0].type).toBe('fact')
    expect(JSON.parse(rows[0].tags)).toEqual(['moonshot', 'api'])
    expect(JSON.parse(rows[0].metadata).scope).toBe('global')
  })

  it('UPSERT updates existing row on (namespace, key) conflict', async () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({
      namespace: 'quoth', key: 'foo', content: 'old version',
      type: 'fact', tags: [], metadata: { v: 1 },
    })
    // tiny sleep to ensure updated_at differs
    await new Promise(r => setTimeout(r, 5))
    db.upsertMemoryEntry({
      namespace: 'quoth', key: 'foo', content: 'new version',
      type: 'fact', tags: ['new'], metadata: { v: 2 },
    })
    const rows = db.prepare('SELECT * FROM memory_entries WHERE namespace = ? AND key = ?').all('quoth', 'foo')
    expect(rows.length).toBe(1)
    expect(rows[0].content).toBe('new version')
    expect(JSON.parse(rows[0].metadata).v).toBe(2)
    expect(rows[0].updated_at).toBeGreaterThanOrEqual(rows[0].created_at)
  })

  it('same key across namespaces is permitted', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'project-a', key: 'foo', content: 'A', type: 'fact', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'project-b', key: 'foo', content: 'B', type: 'fact', tags: [], metadata: {} })
    const all = db.prepare("SELECT * FROM memory_entries WHERE key = 'foo'").all()
    expect(all.length).toBe(2)
  })
})

describe('listFactsByNamespace', () => {
  it('returns facts sorted by updated_at DESC', async () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'a', content: 'first', type: 'fact', tags: [], metadata: {} })
    await new Promise(r => setTimeout(r, 5))
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'b', content: 'second', type: 'fact', tags: [], metadata: {} })
    const rows = db.listFactsByNamespace('quoth', 10)
    expect(rows.map(r => r.key)).toEqual(['b', 'a'])
  })

  it('only returns active, type=fact rows', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'a', content: 'x', type: 'semantic', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'b', content: 'y', type: 'fact', tags: [], metadata: {} })
    expect(db.listFactsByNamespace('quoth', 10).map(r => r.key)).toEqual(['b'])
  })

  it('respects the limit parameter', () => {
    const { db } = tmpDb()
    for (let i = 0; i < 15; i++) {
      db.upsertMemoryEntry({ namespace: 'quoth', key: `f${i}`, content: 'x', type: 'fact', tags: [], metadata: {} })
    }
    expect(db.listFactsByNamespace('quoth', 5).length).toBe(5)
  })
})

describe('deleteMemoryEntry', () => {
  it('deletes by (namespace, key)', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'quoth', key: 'zap', content: 'x', type: 'fact', tags: [], metadata: {} })
    const n = db.deleteMemoryEntry({ namespace: 'quoth', key: 'zap' })
    expect(n).toBe(1)
    expect(db.listFactsByNamespace('quoth', 10).length).toBe(0)
  })

  it('returns 0 if the entry does not exist', () => {
    const { db } = tmpDb()
    expect(db.deleteMemoryEntry({ namespace: 'missing', key: 'missing' })).toBe(0)
  })

  it('leaves other namespaces untouched', () => {
    const { db } = tmpDb()
    db.upsertMemoryEntry({ namespace: 'a', key: 'f', content: 'x', type: 'fact', tags: [], metadata: {} })
    db.upsertMemoryEntry({ namespace: 'b', key: 'f', content: 'x', type: 'fact', tags: [], metadata: {} })
    db.deleteMemoryEntry({ namespace: 'a', key: 'f' })
    expect(db.listFactsByNamespace('a', 10).length).toBe(0)
    expect(db.listFactsByNamespace('b', 10).length).toBe(1)
  })
})
