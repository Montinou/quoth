// tests/unit/inject/scope-filter.test.js
//
// `/inject?project=a` must return entities scoped to 'project:a' OR 'global'
// and MUST NOT leak entities from another project (e.g. 'project:b').
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

function makeEmbeddingBuffer(fill) {
  const arr = new Float32Array(384).fill(fill)
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

function httpGET(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null })
        } catch (err) {
          reject(new Error(`Invalid JSON: ${body}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')) })
  })
}

describe('/inject scope filter', () => {
  let home, savedHome, db, srv, port

  beforeEach(async () => {
    savedHome = process.env.QUOTH_HOME
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-inject-scope-'))
    process.env.QUOTH_HOME = home

    const { _resetKnowledgeSingleton } = requireCjs('../../../daemon/lib/hnsw.js')
    _resetKnowledgeSingleton()

    const { createDb } = requireCjs('../../../daemon/db.js')
    db = createDb(path.join(home, 'memory.db'))

    const { upsertEntity } = requireCjs('../../../daemon/lib/knowledge-entities.js')
    // All three use the same embedding so they're all HNSW candidates.
    const vec = makeEmbeddingBuffer(0.1)
    upsertEntity({
      kind: 'pattern', scope: 'project:a',
      summary: 'proj-a-sum', content: 'content-for-a',
      metadata: {}, tags: [], source: 'extracted', source_session_id: 'sa',
      embedding: vec,
    })
    upsertEntity({
      kind: 'pattern', scope: 'project:b',
      summary: 'proj-b-sum', content: 'content-for-b',
      metadata: {}, tags: [], source: 'extracted', source_session_id: 'sb',
      embedding: vec,
    })
    upsertEntity({
      kind: 'pattern', scope: 'global',
      summary: 'global-sum', content: 'content-for-global',
      metadata: {}, tags: [], source: 'extracted', source_session_id: 'sg',
      embedding: vec,
    })

    const promptVec = new Float32Array(384).fill(0.1)
    const { buildQueryServer } = requireCjs('../../../daemon/lib/query-server.js')
    srv = buildQueryServer({
      db,
      log: () => {},
      embedPrompt: async () => promptVec,
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    port = srv.address().port
  })

  afterEach(() => {
    try { srv && srv.close() } catch {}
    try { db && db.close && db.close() } catch {}
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    if (savedHome === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = savedHome
    const { _resetKnowledgeSingleton } = requireCjs('../../../daemon/lib/hnsw.js')
    _resetKnowledgeSingleton()
  })

  it('returns project:a + global and excludes project:b', async () => {
    const res = await httpGET(
      port,
      '/inject?prompt=hello&project=a&kinds=pattern&limit=10'
    )
    expect(res.status).toBe(200)
    const summaries = res.body.results.map((r) => r.summary).sort()
    expect(summaries).toContain('proj-a-sum')
    expect(summaries).toContain('global-sum')
    expect(summaries).not.toContain('proj-b-sum')
  })
})
