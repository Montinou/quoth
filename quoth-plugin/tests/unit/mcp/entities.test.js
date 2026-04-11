// tests/unit/mcp/entities.test.js
//
// Task 20 / spec §6.3: the `mcp/handlers/entities.js` handler replaces the
// legacy `patterns.js` handler and surfaces 11 tools. Each tool is a plain
// async function called via the shared `handle(name, args, db)` entrypoint,
// so these tests drive the dispatch path directly against a scratch
// QUOTH_HOME.
//
// The split:
//  - DB-only tools (top/score/promote/log_*) exercise `knowledge-entities.js`
//    helpers through the real SQLite path — no HTTP.
//  - Daemon-bound tools (search/recall_*/health/replay) fetch /inject or
//    /health via unix socket; we stand up an in-process http.Server on the
//    daemon socket and capture the received URLs (same pattern as the
//    subagent-start test).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)

function loadFresh() {
  // CJS modules — force re-require so each test sees a fresh
  // knowledge-entities / entities module bound to the current QUOTH_HOME.
  const keep = new Set()
  for (const k of Object.keys(require_.cache)) {
    if (k.includes('/quoth-plugin/')) delete require_.cache[k]
    else keep.add(k)
  }
  const entities = require_('../../../mcp/handlers/entities.js')
  const ke = require_('../../../daemon/lib/knowledge-entities.js')
  const { openDb } = require_('../../../daemon/db.js')
  return { entities, ke, db: openDb() }
}

describe('mcp/handlers/entities', () => {
  let home
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-entities-'))
    process.env.QUOTH_HOME = home
  })
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    delete process.env.QUOTH_HOME
  })

  describe('tool manifest', () => {
    it('exports exactly the 11 Task-20 tools', () => {
      const { entities } = loadFresh()
      const names = entities.TOOLS.map((t) => t.name).sort()
      expect(names).toEqual([
        'quoth_health',
        'quoth_log_anti_pattern',
        'quoth_log_decision',
        'quoth_promote_entity',
        'quoth_recall_anti_patterns',
        'quoth_recall_decisions',
        'quoth_recall_global',
        'quoth_replay_session',
        'quoth_score_entity',
        'quoth_search_entities',
        'quoth_top_entities',
      ])
    })
    it('every tool has a description and inputSchema', () => {
      const { entities } = loadFresh()
      for (const t of entities.TOOLS) {
        expect(typeof t.description).toBe('string')
        expect(t.description.length).toBeGreaterThan(10)
        expect(t.inputSchema).toBeTruthy()
        expect(t.inputSchema.type).toBe('object')
      }
    })
  })

  describe('quoth_top_entities', () => {
    it('returns rows filtered by kind, sorted by confidence desc', async () => {
      const { entities, ke, db } = loadFresh()
      ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 'high', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
      ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 'low',  content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's2' })
      ke.upsertEntity({ kind: 'decision', scope: 'global', summary: 'd',    content: 'c', metadata: {}, tags: [], source: 'extracted', source_session_id: 's3' })
      const res = await entities.handle('quoth_top_entities', { kind: 'pattern', limit: 10 }, db)
      expect(res.count).toBe(2)
      expect(res.entities.every((e) => e.kind === 'pattern')).toBe(true)
    })
    it('returns all kinds when kind filter is omitted', async () => {
      const { entities, ke, db } = loadFresh()
      ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 'p', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 's1' })
      ke.upsertEntity({ kind: 'decision', scope: 'global', summary: 'd', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 's2' })
      const res = await entities.handle('quoth_top_entities', { limit: 10 }, db)
      expect(res.count).toBe(2)
    })
  })

  describe('error paths', () => {
    it('quoth_search_entities returns fail-open shape when daemon socket is missing', async () => {
      const { entities, db } = loadFresh()
      // No server stood up under this home → socket does not exist.
      const res = await entities.handle('quoth_search_entities', { query: 'x' }, db)
      expect(res.count).toBe(0)
      expect(res.entities).toEqual([])
      expect(res.error).toBeTruthy()
    })
    it('quoth_score_entity rejects unknown outcome values', async () => {
      const { entities, ke, db } = loadFresh()
      const e = ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's', content: 'cX', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sX' })
      const res = await entities.handle('quoth_score_entity', { id: e.id, outcome: 'maybe' }, db)
      expect(res.error).toMatch(/outcome/i)
    })
    it('quoth_top_entities coerces string limit to number', async () => {
      const { entities, ke, db } = loadFresh()
      ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 'a', content: 'a', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sa' })
      ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 'b', content: 'b', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sb' })
      const res = await entities.handle('quoth_top_entities', { limit: '1' }, db)
      expect(res.count).toBe(1)
    })
  })

  describe('quoth_score_entity', () => {
    it('applies Bayesian success update (alpha += 1)', async () => {
      const { entities, ke, db } = loadFresh()
      const e = ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's', content: 'c', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sA' })
      const before = ke.getById(e.id)
      const res = await entities.handle('quoth_score_entity', { id: e.id, outcome: 'success' }, db)
      const after = ke.getById(e.id)
      expect(res.updated).toBe(true)
      expect(after.alpha).toBe(before.alpha + 1)
    })
    it('applies Bayesian failure update (beta += 1)', async () => {
      const { entities, ke, db } = loadFresh()
      const e = ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's', content: 'c2', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sB' })
      const before = ke.getById(e.id)
      await entities.handle('quoth_score_entity', { id: e.id, outcome: 'failure' }, db)
      const after = ke.getById(e.id)
      expect(after.beta).toBe(before.beta + 1)
    })
    it('returns error shape for unknown id', async () => {
      const { entities, db } = loadFresh()
      const res = await entities.handle('quoth_score_entity', { id: 'nope', outcome: 'success' }, db)
      expect(res.error).toBeTruthy()
    })
  })

  describe('quoth_log_decision', () => {
    it('inserts a decision entity with agent_logged source', async () => {
      const { entities, ke, db } = loadFresh()
      const res = await entities.handle('quoth_log_decision', {
        situation: 'migrating from JUDGE to triage',
        options: ['keep JUDGE', 'new triage stage'],
        choice: 'new triage stage',
        reasoning: 'single stage is simpler',
      }, db)
      expect(res.logged).toBe(true)
      expect(res.id).toHaveLength(16)
      const row = ke.getById(res.id)
      expect(row.kind).toBe('decision')
      expect(row.source).toBe('agent_logged')
      const meta = JSON.parse(row.metadata)
      expect(meta.choice).toBe('new triage stage')
    })
  })

  describe('quoth_log_anti_pattern', () => {
    it('inserts an anti_pattern entity with negative polarity', async () => {
      const { entities, ke, db } = loadFresh()
      const res = await entities.handle('quoth_log_anti_pattern', {
        condition: 'two pipeline stages holding the same lock',
        what_not_to_do: 'acquire llm-budget lock inside persist transaction',
        why_failed: 'deadlock when budget reservation retries',
      }, db)
      expect(res.logged).toBe(true)
      const row = ke.getById(res.id)
      expect(row.kind).toBe('anti_pattern')
      expect(row.polarity).toBe('negative')
      expect(row.source).toBe('agent_logged')
    })
  })

  describe('quoth_promote_entity', () => {
    it('promotes a project entity to global scope', async () => {
      const { entities, ke, db } = loadFresh()
      const e = ke.upsertEntity({ kind: 'pattern', scope: 'project:quoth', summary: 's', content: 'cp', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sP' })
      const res = await entities.handle('quoth_promote_entity', { id: e.id }, db)
      expect(res.promoted).toBe(true)
      const row = ke.getById(e.id)
      expect(row.scope).toBe('global')
    })
    it('no-ops when already global', async () => {
      const { entities, ke, db } = loadFresh()
      const e = ke.upsertEntity({ kind: 'pattern', scope: 'global', summary: 's', content: 'cg', metadata: {}, tags: [], source: 'extracted', source_session_id: 'sG' })
      const res = await entities.handle('quoth_promote_entity', { id: e.id }, db)
      expect(res.alreadyGlobal).toBe(true)
    })
  })

  // ---- Daemon-bound tools: set up a fake HTTP server on daemon.sock ----
  describe('daemon-bound tools', () => {
    let server, received
    beforeEach(async () => {
      received = []
      server = http.createServer((req, res) => {
        received.push({ method: req.method, url: req.url })
        if (req.method === 'GET' && req.url.startsWith('/inject')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ results: [
            { id: 'ent1', kind: 'decision', summary: 'fake', content: 'body', confidence: 0.9, score: 0.8 },
          ] }))
          return
        }
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ daemon: { pid: 1, uptime_s: 1, queue_depth: 0, in_flight: 0 }, errors_24h: 0, budget: {}, stuck_files: [], recent_failures: [] }))
          return
        }
        res.writeHead(404); res.end()
      })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(path.join(home, 'daemon.sock'), resolve)
      })
    })
    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()))
        server = null
      }
    })

    it('quoth_search_entities forwards query and kinds to /inject', async () => {
      const { entities, db } = loadFresh()
      const res = await entities.handle('quoth_search_entities', { query: 'adding http endpoint', kinds: ['pattern', 'decision'], limit: 3 }, db)
      expect(res.count).toBe(1)
      const url = received.find((r) => r.url.startsWith('/inject'))
      expect(url).toBeTruthy()
      expect(url.url).toContain('prompt=adding+http+endpoint')
      expect(url.url).toContain('kinds=pattern%2Cdecision')
      expect(url.url).toContain('limit=3')
    })

    it('quoth_recall_decisions pins kinds=decision', async () => {
      const { entities, db } = loadFresh()
      await entities.handle('quoth_recall_decisions', { situation: 'schema migration', limit: 2 }, db)
      const url = received.find((r) => r.url.startsWith('/inject'))
      expect(url).toBeTruthy()
      expect(url.url).toContain('kinds=decision')
    })

    it('quoth_recall_anti_patterns pins kinds=anti_pattern', async () => {
      const { entities, db } = loadFresh()
      await entities.handle('quoth_recall_anti_patterns', { situation: 'deadlock', limit: 2 }, db)
      const url = received.find((r) => r.url.startsWith('/inject'))
      expect(url.url).toContain('kinds=anti_pattern')
    })

    it('quoth_recall_global forces project=global scope', async () => {
      const { entities, db } = loadFresh()
      await entities.handle('quoth_recall_global', { query: 'auth patterns' }, db)
      const url = received.find((r) => r.url.startsWith('/inject'))
      expect(url.url).toContain('project=global')
    })

    it('quoth_health hits GET /health', async () => {
      const { entities, db } = loadFresh()
      const res = await entities.handle('quoth_health', {}, db)
      expect(res.daemon).toBeTruthy()
      const hit = received.find((r) => r.url === '/health')
      expect(hit).toBeTruthy()
    })
  })

  // ---- replay_session: reads JSONL from error/ ----
  describe('quoth_replay_session', () => {
    it('reads JSONL from error/ bucket and returns a dry-run diff', async () => {
      const { entities, db } = loadFresh()
      const errDir = path.join(home, 'trajectories/error/2026-04-11')
      fs.mkdirSync(errDir, { recursive: true })
      fs.writeFileSync(path.join(errDir, 'sess-x.jsonl'),
        JSON.stringify({ event: 'tool_use', tool: 'Write' }) + '\n' +
        JSON.stringify({ event: 'tool_use', tool: 'Edit' }) + '\n'
      )
      fs.writeFileSync(path.join(errDir, 'sess-x.meta.json'), JSON.stringify({ session_id: 'sess-x', project: 'q', status: 'error' }))
      const res = await entities.handle('quoth_replay_session', { session_id: 'sess-x' }, db)
      expect(res.session_id).toBe('sess-x')
      expect(res.found).toBe(true)
      expect(res.entry_count).toBe(2)
      expect(res.dry_run).toBe(true)
    })
    it('returns found=false for a missing session', async () => {
      const { entities, db } = loadFresh()
      const res = await entities.handle('quoth_replay_session', { session_id: 'ghost' }, db)
      expect(res.found).toBe(false)
    })
  })
})
