import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('embedEntities', () => {
  let home, embed

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'quoth-embed-'))
    process.env.QUOTH_HOME = home
    vi.resetModules()
    embed = await import('../../../daemon/pipeline/embed.js')
  })

  afterEach(() => {
    delete process.env.QUOTH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('batches all 4 kinds into one call', async () => {
    const entities = [
      { kind: 'pattern', content: 'a' },
      { kind: 'fact', content: 'b' },
      { kind: 'decision', content: 'c' },
      { kind: 'anti_pattern', content: 'd' },
    ]
    const fakeBatch = vi.fn().mockResolvedValue([
      new Float32Array(384),
      new Float32Array(384),
      new Float32Array(384),
      new Float32Array(384),
    ])

    const out = await embed.embedEntities(entities, { generateEmbeddingBatch: fakeBatch })

    expect(fakeBatch).toHaveBeenCalledTimes(1)
    expect(fakeBatch).toHaveBeenCalledWith(['a', 'b', 'c', 'd'])
    expect(out).toHaveLength(4)
    expect(out[0].embedding).toBeInstanceOf(Float32Array)
    expect(out[1].embedding).toBeInstanceOf(Float32Array)
    expect(out[2].embedding).toBeInstanceOf(Float32Array)
    expect(out[3].embedding).toBeInstanceOf(Float32Array)
  })

  it('on failure returns entities without embeddings + marks embedding_indexed=0', async () => {
    const fakeBatch = vi.fn().mockRejectedValue(new Error('onnx-crash'))

    const out = await embed.embedEntities(
      [{ kind: 'pattern', content: 'a' }],
      { generateEmbeddingBatch: fakeBatch }
    )

    expect(out).toHaveLength(1)
    expect(out[0].embedding).toBeNull()
    expect(out[0].embedding_indexed).toBe(0)
  })
})
