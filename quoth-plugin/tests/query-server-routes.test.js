// Query server HTTP routes for session status + facts CRUD (Task 18, spec §10.2 #10).
//
// These tests exercise buildQueryServer() — the new raw http.Server builder
// that does not hard-code a unix socket path. Start on an ephemeral loopback
// port, hit it with real http.get / http.request, assert JSON responses.
//
// We use a real DB (createDb) and real filesystem sidecars — no mocking of
// db writes or trajectory layout. Each test isolates via mkdtempSync.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)
const { createDb } = requireCjs('../daemon/db.js')
const { buildQueryServer } = requireCjs('../daemon/lib/query-server.js')

function setupHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-query-routes-'))
  for (const b of ['active', 'processing', 'done/2026-04-10/quoth', 'routine', 'empty', 'error']) {
    fs.mkdirSync(path.join(tmp, 'trajectories', b), { recursive: true })
  }
  return tmp
}

function startServer(db, home) {
  return new Promise((resolve) => {
    const server = buildQueryServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ srv: server, port: server.address().port })
    })
  })
}

function httpGET(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null })
        } catch (e) {
          reject(new Error(`Invalid JSON in response: ${body}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('GET timeout')) })
  })
}

function httpDELETE(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'DELETE' },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null })
          } catch (e) {
            reject(new Error(`Invalid JSON in response: ${body}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('DELETE timeout')) })
    req.end()
  })
}

describe('query-server — session + facts routes', () => {
  let home, db, srv, port, savedHome

  beforeEach(async () => {
    savedHome = process.env.QUOTH_HOME
    home = setupHome()
    process.env.QUOTH_HOME = home
    db = createDb(path.join(home, 'query.db'))
    const started = await startServer(db, home)
    srv = started.srv
    port = started.port
  })

  afterEach(() => {
    if (srv) {
      try { srv.close() } catch {}
    }
    try { db && db.close && db.close() } catch {}
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    if (savedHome === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = savedHome
  })

  describe('GET /sessions/:sid/status', () => {
    it('returns 404 for unknown session', async () => {
      const res = await httpGET(port, '/sessions/nope/status')
      expect(res.status).toBe(404)
      expect(res.body && res.body.error).toBe('not_found')
    })

    it('finds a session in active/', async () => {
      const sid = 'q-active'
      fs.writeFileSync(path.join(home, 'trajectories', 'active', `${sid}.jsonl`), '{}\n')
      fs.writeFileSync(
        path.join(home, 'trajectories', 'active', `${sid}.meta.json`),
        JSON.stringify({
          session_id: sid, project: 'quoth', status: 'active',
          first_seen_ts: 1, last_seen_ts: 2, tool_count: 3,
        })
      )

      const res = await httpGET(port, `/sessions/${sid}/status`)
      expect(res.status).toBe(200)
      expect(res.body.session_id).toBe(sid)
      expect(res.body.status).toBe('active')
      expect(res.body.location).toBe('active')
      expect(res.body.tool_count).toBe(3)
    })

    it('finds a session in done/YYYY-MM-DD/<project>/', async () => {
      const sid = 'q-done'
      const doneDir = path.join(home, 'trajectories', 'done', '2026-04-10', 'quoth')
      fs.writeFileSync(path.join(doneDir, `${sid}.jsonl`), '{}\n')
      fs.writeFileSync(
        path.join(doneDir, `${sid}.meta.json`),
        JSON.stringify({
          session_id: sid, project: 'quoth', status: 'done', tool_count: 10,
        })
      )

      const res = await httpGET(port, `/sessions/${sid}/status`)
      expect(res.status).toBe(200)
      expect(res.body.session_id).toBe(sid)
      expect(res.body.location).toContain('done')
      expect(res.body.location).toContain('2026-04-10')
      expect(res.body.location).toContain('quoth')
      expect(res.body.tool_count).toBe(10)
    })
  })

  describe('GET /facts/:namespace', () => {
    it('returns empty array for unknown namespace', async () => {
      const res = await httpGET(port, '/facts/facts:proj:unknown')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns facts with topic/statement/scope', async () => {
      db.insertNewFact(
        { topic: 'build', statement: 'pnpm test', scope: 'project', tags: ['build'] },
        { project: 'quoth', session_id: 's' }
      )
      db.insertNewFact(
        { topic: 'lint', statement: 'pnpm lint', scope: 'project', tags: [] },
        { project: 'quoth', session_id: 's' }
      )

      const res = await httpGET(port, '/facts/facts:proj:quoth')
      expect(res.status).toBe(200)
      expect(res.body.length).toBe(2)
      expect(res.body.map((r) => r.topic).sort()).toEqual(['build', 'lint'])
      const build = res.body.find((r) => r.topic === 'build')
      expect(build.statement).toBe('pnpm test')
      expect(build.scope).toBe('project')
      expect(Array.isArray(build.tags)).toBe(true)
    })

    it('honors ?limit=N', async () => {
      for (let i = 0; i < 5; i++) {
        db.insertNewFact(
          { topic: `t${i}`, statement: `s${i}`, scope: 'global', tags: [] },
          { project: 'quoth', session_id: 's' }
        )
      }
      const res = await httpGET(port, '/facts/facts:global?limit=2')
      expect(res.status).toBe(200)
      expect(res.body.length).toBe(2)
    })
  })

  describe('DELETE /facts/:namespace/:topic', () => {
    it('archives the fact and returns deleted:true', async () => {
      db.insertNewFact(
        { topic: 'kill-me', statement: 'remove this', scope: 'project', tags: [] },
        { project: 'quoth', session_id: 's' }
      )
      const res = await httpDELETE(port, '/facts/facts:proj:quoth/kill-me')
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)

      const after = await httpGET(port, '/facts/facts:proj:quoth')
      expect(after.body.find((r) => r.topic === 'kill-me')).toBeUndefined()
    })

    it('returns deleted:false for unknown fact', async () => {
      const res = await httpDELETE(port, '/facts/facts:proj:quoth/nope')
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(false)
    })
  })
})
