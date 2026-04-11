// tests/unit/db/knowledge-entities.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('knowledge-entities helpers', () => {
  let home, ke
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-ke-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
    ke = await import(`../../../daemon/lib/knowledge-entities.js`)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('computes a stable id as sha1(kind + canonical_content)[:16]', () => {
    const id1 = ke.computeEntityId('pattern', 'hello world')
    const id2 = ke.computeEntityId('pattern', 'hello world')
    const id3 = ke.computeEntityId('fact', 'hello world')
    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id1).toHaveLength(16)
  })

  it('upserts a new entity and reads it back', () => {
    const inserted = ke.upsertEntity({
      kind: 'pattern',
      scope: 'project:quoth',
      summary: 'test pattern',
      content: 'canonical body',
      metadata: { condition: 'x', action: 'y' },
      tags: ['foo'],
      source: 'extracted',
      source_session_id: 'sess-1',
    })
    expect(inserted.id).toHaveLength(16)
    expect(inserted.alpha).toBe(1)
    const row = ke.getById(inserted.id)
    expect(row.kind).toBe('pattern')
    expect(JSON.parse(row.metadata).condition).toBe('x')
  })

  it('searchByKind returns only matching kind + active status', () => {
    ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's1', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
    ke.upsertEntity({ kind: 'fact',    scope: 'global', summary: 's2', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
    const patterns = ke.searchByKind('pattern', 10)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].kind).toBe('pattern')
  })

  it('listByScope filters to one project', () => {
    ke.upsertEntity({ kind: 'pattern', scope: 'project:alpha', summary: 's1', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's' })
    ke.upsertEntity({ kind: 'pattern', scope: 'project:beta',  summary: 's2', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's' })
    const alpha = ke.listByScope('project:alpha', 10)
    expect(alpha).toHaveLength(1)
    expect(alpha[0].scope).toBe('project:alpha')
  })
})
