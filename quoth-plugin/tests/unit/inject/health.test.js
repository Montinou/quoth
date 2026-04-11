// tests/unit/inject/health.test.js
//
// GET /health endpoint — spec §5.5 contract.
//
// Asserts the full response shape (daemon / errors_24h / budget / stuck_files /
// recent_failures), aggregation of pipeline_errors by stage+severity within
// the last 24h, stuck-file scan of trajectories/processing/, budget row fetch
// from llm_budget, and DI of the daemon state via getDaemonState.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createRequire } from 'module'

const requireCjs = createRequire(import.meta.url)

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

async function startServer(opts) {
  const { buildQueryServer } = requireCjs('../../../daemon/lib/query-server.js')
  const srv = buildQueryServer(opts)
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  return { srv, port: srv.address().port }
}

function utcDateToday() {
  return new Date().toISOString().slice(0, 10)
}

describe('GET /health — spec §5.5', () => {
  let home, savedHome, savedBudget, db, srv, port

  beforeEach(() => {
    savedHome = process.env.QUOTH_HOME
    savedBudget = process.env.QUOTH_DAILY_LLM_BUDGET_USD
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'quoth-health-'))
    process.env.QUOTH_HOME = home
    // Force a deterministic limit; default in code is also '1.00' but pin it.
    process.env.QUOTH_DAILY_LLM_BUDGET_USD = '1.00'

    fs.mkdirSync(path.join(home, 'trajectories', 'processing'), { recursive: true })

    const { createDb } = requireCjs('../../../daemon/db.js')
    db = createDb(path.join(home, 'memory.db'))
  })

  afterEach(() => {
    try { srv && srv.close() } catch {}
    srv = null
    try { db && db.close && db.close() } catch {}
    try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
    if (savedHome === undefined) delete process.env.QUOTH_HOME
    else process.env.QUOTH_HOME = savedHome
    if (savedBudget === undefined) delete process.env.QUOTH_DAILY_LLM_BUDGET_USD
    else process.env.QUOTH_DAILY_LLM_BUDGET_USD = savedBudget
  })

  it('returns the full shape on an empty DB + empty processing dir', async () => {
    const started = await startServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
    })
    srv = started.srv
    port = started.port

    const res = await httpGET(port, '/health')
    expect(res.status).toBe(200)
    const body = res.body

    // daemon
    expect(body.daemon).toBeTruthy()
    expect(typeof body.daemon.pid).toBe('number')
    expect(body.daemon.pid).toBe(process.pid)
    expect(typeof body.daemon.uptime_s).toBe('number')
    expect(body.daemon.uptime_s).toBeGreaterThanOrEqual(0)
    expect(body.daemon.queue_depth).toBe(0)
    expect(body.daemon.in_flight).toBe(0)

    // errors_24h — all three stages present, all severities zeroed
    expect(body.errors_24h).toBeTruthy()
    for (const stage of ['triage', 'extract', 'persist']) {
      expect(body.errors_24h[stage]).toBeTruthy()
      expect(body.errors_24h[stage].error).toBe(0)
      expect(body.errors_24h[stage].warn).toBe(0)
      expect(body.errors_24h[stage].degraded).toBe(0)
    }

    // budget — no row yet, fallback shape
    expect(body.budget).toBeTruthy()
    expect(body.budget.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.budget.spend_usd).toBe(0)
    expect(body.budget.limit_usd).toBe(1.0)

    // stuck files + recent failures
    expect(Array.isArray(body.stuck_files)).toBe(true)
    expect(body.stuck_files.length).toBe(0)
    expect(Array.isArray(body.recent_failures)).toBe(true)
    expect(body.recent_failures.length).toBe(0)
  })

  it('aggregates errors_24h by stage+severity and excludes rows older than 24h', async () => {
    const { logPipelineError } = requireCjs('../../../daemon/db.js')

    for (let i = 0; i < 2; i++) logPipelineError({ stage: 'triage',  severity: 'error',    error_message: 'te' })
    for (let i = 0; i < 5; i++) logPipelineError({ stage: 'triage',  severity: 'warn',     error_message: 'tw' })
    logPipelineError({ stage: 'extract', severity: 'error',    error_message: 'ee' })
    for (let i = 0; i < 12; i++) logPipelineError({ stage: 'extract', severity: 'degraded', error_message: 'ed' })
    logPipelineError({ stage: 'persist', severity: 'error',    error_message: 'pe' })

    // Backdate the persist error row >24h so it should be excluded.
    const oldTs = Date.now() - (25 * 60 * 60 * 1000)
    db.prepare(`UPDATE pipeline_errors SET ts = ? WHERE stage = 'persist' AND error_message = 'pe'`).run(oldTs)

    const started = await startServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
    })
    srv = started.srv
    port = started.port

    const res = await httpGET(port, '/health')
    expect(res.status).toBe(200)
    const e = res.body.errors_24h
    expect(e.triage.error).toBe(2)
    expect(e.triage.warn).toBe(5)
    expect(e.triage.degraded).toBe(0)
    expect(e.extract.error).toBe(1)
    expect(e.extract.degraded).toBe(12)
    expect(e.extract.warn).toBe(0)
    // Backdated row must be excluded.
    expect(e.persist.error).toBe(0)
    expect(e.persist.warn).toBe(0)
    expect(e.persist.degraded).toBe(0)

    // recent_failures: the extract error is the only in-window error/degraded
    // row from the "error" / "degraded" set — but we have 12 degraded extract
    // rows as well. Just assert LIMIT 5 and schema.
    expect(res.body.recent_failures.length).toBeLessThanOrEqual(5)
    for (const r of res.body.recent_failures) {
      expect(r).toHaveProperty('ts')
      expect(r).toHaveProperty('stage')
      expect(r).toHaveProperty('severity')
      expect(['error', 'degraded']).toContain(r.severity)
      expect(r).toHaveProperty('error_message')
    }
  })

  it('detects stuck files in trajectories/processing/ older than the age threshold', async () => {
    const procDir = path.join(home, 'trajectories', 'processing')
    const stuckFile = path.join(procDir, 'abc-123.jsonl')
    const freshFile = path.join(procDir, 'fresh-456.jsonl')
    fs.writeFileSync(stuckFile, '{}\n')
    fs.writeFileSync(freshFile, '{}\n')
    // Sidecar for the stuck file — MUST be ignored by the scan.
    fs.writeFileSync(path.join(procDir, 'abc-123.meta.json'), '{}')

    const twentyFiveHoursAgoSec = (Date.now() - (25 * 60 * 60 * 1000)) / 1000
    fs.utimesSync(stuckFile, twentyFiveHoursAgoSec, twentyFiveHoursAgoSec)

    const started = await startServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
    })
    srv = started.srv
    port = started.port

    const res = await httpGET(port, '/health')
    expect(res.status).toBe(200)
    const stuck = res.body.stuck_files
    expect(stuck.length).toBe(1)
    expect(stuck[0].session_id).toBe('abc-123')
    expect(typeof stuck[0].age_hours).toBe('number')
    expect(stuck[0].age_hours).toBeGreaterThanOrEqual(24)
  })

  it('surfaces spend_usd from llm_budget when a row exists for today', async () => {
    const today = utcDateToday()
    db.prepare(`
      INSERT INTO llm_budget (date, spend_usd, triage_calls, extract_calls, updated_at)
      VALUES (?, ?, 0, 0, ?)
    `).run(today, 0.42, Date.now())

    const started = await startServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
    })
    srv = started.srv
    port = started.port

    const res = await httpGET(port, '/health')
    expect(res.status).toBe(200)
    expect(res.body.budget.date).toBe(today)
    expect(res.body.budget.spend_usd).toBeCloseTo(0.42, 5)
    expect(res.body.budget.limit_usd).toBe(1.0)
  })

  it('honors the getDaemonState DI option', async () => {
    const started = await startServer({
      db,
      log: () => {},
      trajectoriesDir: path.join(home, 'trajectories'),
      getDaemonState: () => ({ queue_depth: 7, in_flight: 3 }),
    })
    srv = started.srv
    port = started.port

    const res = await httpGET(port, '/health')
    expect(res.status).toBe(200)
    expect(res.body.daemon.queue_depth).toBe(7)
    expect(res.body.daemon.in_flight).toBe(3)
  })
})
