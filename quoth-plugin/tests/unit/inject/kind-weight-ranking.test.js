// tests/unit/inject/kind-weight-ranking.test.js
//
// When two entities share an embedding (cosine equal) and a project scope,
// `/inject` should rank them by kind_weight. Defaults: anti_pattern=1.5 > decision=1.3 > pattern=1.0.
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

describe('/inject kind-weight ranking', () => {
  let home, savedHome, db, srv, port

  beforeEach(async () => {
    savedHome = process.env.QUOTH_HOME
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-inject-kind-'))
    process.env.QUOTH_HOME = home

    // Reset cross-module HNSW singleton BEFORE any consumer loads the index.
    const { _resetKnowledgeSingleton } = requireCjs('../../../daemon/lib/hnsw.js')
    _resetKnowledgeSingleton()

    const { createDb } = requireCjs('../../../daemon/db.js')
    db = createDb(path.join(home, 'memory.db'))

    const { upsertEntity } = requireCjs('../../../daemon/lib/knowledge-entities.js')
    const vec = makeEmbeddingBuffer(0.1)
    upsertEntity({
      kind: 'pattern',
      scope: 'project:q',
      summary: 'p-sum',
      content: 'p-body',
      metadata: { condition: 'x', action: 'y' },
      tags: [],
      source: 'extracted',
      source_session_id: 'sess-1',
      embedding: vec,
    })
    upsertEntity({
      kind: 'anti_pattern',
      scope: 'project:q',
      summary: 'a-sum',
      content: 'a-body',
      metadata: { condition: 'x', what_not_to_do: 'y', why_failed: 'z' },
      tags: [],
      source: 'extracted',
      source_session_id: 'sess-2',
      embedding: vec,
    })

    // Stub the embedder so the test doesn't load MiniLM.
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

  it('anti_pattern ranks above pattern when cosine is equal', async () => {
    const res = await httpGET(
      port,
      '/inject?prompt=test&kinds=pattern,anti_pattern&project=q&limit=5'
    )
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.results)).toBe(true)
    expect(res.body.results.length).toBeGreaterThanOrEqual(2)
    expect(res.body.results[0].kind).toBe('anti_pattern')
  })
})
