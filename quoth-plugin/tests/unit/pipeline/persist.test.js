import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('persistSession', () => {
  let home, persist, ke
  const fakeHnsw = { add: vi.fn(), save: vi.fn() }

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-persist-'))
    process.env.QUOTH_HOME = home
    fakeHnsw.add.mockClear()
    vi.resetModules()
    persist = await import('../../../daemon/pipeline/persist.js')
    ke = await import('../../../daemon/lib/knowledge-entities.js')
  })

  afterEach(() => {
    delete process.env.QUOTH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  const entity = (sid) => ({
    kind: 'pattern',
    scope: 'project:quoth',
    summary: 's',
    content: 'canonical-body',
    metadata: {},
    tags: [],
    source: 'extracted',
    source_session_id: sid,
    embedding: new Float32Array(384),
  })

  it('walk-through: S1 fresh -> S1 retry -> S2 -> S2 retry -> S3 (spec §2.2)', async () => {
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    let row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.alpha).toBe(1)
    expect(row.source_session_id).toBe('S1')

    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.alpha).toBe(1)
    expect(row.source_session_id).toBe('S1') // retry: no-op

    await persist.persistSession({ sessionId: 'S2', entities: [entity('S2')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.alpha).toBe(2)
    expect(row.source_session_id).toBe('S2')

    await persist.persistSession({ sessionId: 'S2', entities: [entity('S2')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.alpha).toBe(2)
    expect(row.source_session_id).toBe('S2') // S2 retry: no-op

    await persist.persistSession({ sessionId: 'S3', entities: [entity('S3')] }, { hnsw: fakeHnsw })
    row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.alpha).toBe(3)
    expect(row.source_session_id).toBe('S3')
  })

  it('HNSW.add called once per new entity id', async () => {
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: fakeHnsw })
    expect(fakeHnsw.add).toHaveBeenCalledTimes(1)
  })

  it('HNSW.add throw -> entity persisted with embedding_indexed=0', async () => {
    const failHnsw = {
      add: vi.fn().mockImplementation(() => { throw new Error('oom') }),
      save: vi.fn(),
    }
    await persist.persistSession({ sessionId: 'S1', entities: [entity('S1')] }, { hnsw: failHnsw })
    const row = ke.getById(ke.computeEntityId('pattern', 'canonical-body'))
    expect(row.embedding_indexed).toBe(0)
  })
})
