// tests/unit/daemon/hnsw-rebuild-on-boot.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Build a 384-dim Float32 Buffer with non-zero magnitude so HNSW distance math
// behaves like production vectors.
function makeEmbeddingBuffer(fill = 0.1) {
  const arr = new Float32Array(384).fill(fill)
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

describe('HNSW rebuild on boot', () => {
  let home
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-hnsw-boot-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
    // Clear the cross-module HNSW singleton cache stored on globalThis so
    // each test starts from a clean slate.
    const hnswMod = await import('../../../daemon/lib/hnsw.js')
    hnswMod._resetKnowledgeSingleton()
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('rebuilds from SQLite when the index file is missing', async () => {
    const ke = await import('../../../daemon/lib/knowledge-entities.js')
    ke.upsertEntity({
      kind: 'pattern',
      scope: 'project:x',
      summary: 's',
      content: 'body1',
      metadata: {},
      tags: [],
      source: 'extracted',
      source_session_id: 'sid',
      embedding: makeEmbeddingBuffer(0.1),
    })

    const hnswMod = await import('../../../daemon/lib/hnsw.js')
    const persistPath = hnswMod.hnswPersistPath(home)
    if (existsSync(persistPath)) unlinkSync(persistPath)

    const idx = await hnswMod.loadOrInit()
    // `size` is a GETTER on HnswIndex, not a method — property access is correct.
    expect(idx.size).toBeGreaterThan(0)
  })

  it('catch-up sweep re-indexes rows with embedding_indexed=0', async () => {
    // Prime a fresh-but-empty persisted index so `loadOrInit` loads it as-is
    // instead of rebuilding from SQLite. That keeps the pre-catch-up graph
    // empty so we can assert that catch-up is what actually inserts the node.
    const hnswMod = await import('../../../daemon/lib/hnsw.js')
    const empty = new hnswMod.HnswIndex()
    const { mkdirSync } = await import('node:fs')
    mkdirSync(home, { recursive: true })
    empty.save(hnswMod.hnswPersistPath(home))

    const ke = await import('../../../daemon/lib/knowledge-entities.js')
    ke.upsertEntity({
      kind: 'pattern',
      scope: 'project:x',
      summary: 's',
      content: 'body2',
      metadata: {},
      tags: [],
      source: 'extracted',
      source_session_id: 'sid',
      embedding: makeEmbeddingBuffer(0.2),
    })

    // `upsertEntity` sets embedding_indexed=1 on insert (embedding present).
    // Flip it back to 0 to simulate a persist-committed-but-HNSW-add-failed
    // row — the exact condition the catch-up sweep is designed to heal.
    const { openDb } = await import('../../../daemon/db.js')
    openDb().prepare(`UPDATE knowledge_entities SET embedding_indexed = 0`).run()

    const idx = await hnswMod.loadOrInit()
    const before = idx.size
    expect(before).toBe(0)

    const { runHnswCatchUp } = await import('../../../daemon/retention.js')
    const result = await runHnswCatchUp()
    expect(result.added).toBe(1)

    const after = (await hnswMod.loadOrInit()).size
    expect(after).toBeGreaterThan(before)

    const { listUnindexed } = await import('../../../daemon/lib/knowledge-entities.js')
    expect(listUnindexed(100)).toHaveLength(0)
  })
})
