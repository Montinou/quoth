// tests/unit/inject/prompt-embedding-cache.test.js
//
// `/inject` caches results by sha1(prompt + project + kinds_csv) for 60s.
// Repeated identical queries hit the cache; different prompts don't.
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

describe('/inject prompt + kinds cache', () => {
  let home, savedHome, db, srv, port, callCount

  beforeEach(async () => {
    savedHome = process.env.QUOTH_HOME
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-inject-cache-'))
    process.env.QUOTH_HOME = home

    const { _resetKnowledgeSingleton } = requireCjs('../../../daemon/lib/hnsw.js')
    _resetKnowledgeSingleton()

    const { createDb } = requireCjs('../../../daemon/db.js')
    db = createDb(path.join(home, 'memory.db'))

    const { upsertEntity } = requireCjs('../../../daemon/lib/knowledge-entities.js')
    upsertEntity({
      kind: 'pattern', scope: 'project:q',
      summary: 'p', content: 'body',
      metadata: {}, tags: [], source: 'extracted', source_session_id: 'sid',
      embedding: makeEmbeddingBuffer(0.1),
    })

    callCount = 0
    const promptVec = new Float32Array(384).fill(0.1)
    const { buildQueryServer } = requireCjs('../../../daemon/lib/query-server.js')
    srv = buildQueryServer({
      db,
      log: () => {},
      embedPrompt: async () => {
        callCount++
        return promptVec
      },
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

  it('cache hit on second identical request; miss on different prompt', async () => {
    const r1 = await httpGET(port, '/inject?prompt=alpha&project=q&kinds=pattern&limit=5')
    expect(r1.status).toBe(200)
    expect(callCount).toBe(1)

    const r2 = await httpGET(port, '/inject?prompt=alpha&project=q&kinds=pattern&limit=5')
    expect(r2.status).toBe(200)
    // Second identical call must NOT re-embed.
    expect(callCount).toBe(1)

    // Different prompt — cache miss.
    const r3 = await httpGET(port, '/inject?prompt=beta&project=q&kinds=pattern&limit=5')
    expect(r3.status).toBe(200)
    expect(callCount).toBe(2)
  })
})
