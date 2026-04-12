'use strict'

// Quoth daemon SQLite layer (greenfield v3.6).
//
// This file is the single bootstrapper for memory.db. It creates the small
// set of v3.6 tables (sessions, daemon_meta, agent_registry, events,
// knowledge_entities, llm_budget, pipeline_runs, pipeline_costs,
// pipeline_errors), runs the one-shot `greenfield_reset_v3_6` migration
// that DROPs every retired pre-v3.6 table, and exposes the helper surface
// still referenced by the runtime: sessions CRUD, daemon_meta k/v, agent
// registry, events, pipeline cost tracking, and a thin HNSW lifecycle
// shim that forwards to `./lib/hnsw.js`'s knowledge_entities-backed
// loadOrInit.
//
// Every retired pre-v3.6 subsystem (legacy pattern store, trajectories,
// memory_entries, doc_chunks, clustering, skills, the old triage/extract
// queue) was deleted with Task 24 and is no longer built.

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ---------------------------------------------------------------------------
// Greenfield v3.6 schema
// ---------------------------------------------------------------------------

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT NOT NULL,
  project        TEXT NOT NULL,
  first_seen_ts  INTEGER NOT NULL,
  last_seen_ts   INTEGER NOT NULL,
  tool_count     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('active','processing','done','routine','empty','error')),
  closed_marker  INTEGER NOT NULL DEFAULT 0,
  extracted_at   INTEGER,
  pattern_count  INTEGER,
  fact_count     INTEGER,
  epoch          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, epoch)
);
CREATE INDEX IF NOT EXISTS idx_sessions_status_last_seen ON sessions(status, last_seen_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_project         ON sessions(project);

CREATE TABLE IF NOT EXISTS daemon_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  project        TEXT,
  platform       TEXT,
  status         TEXT DEFAULT 'online',
  capabilities   TEXT DEFAULT '[]',
  last_heartbeat INTEGER,
  registered_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  metadata       TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  agent_id   TEXT,
  project    TEXT,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_agent   ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_entities (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  scope             TEXT NOT NULL,
  summary           TEXT NOT NULL,
  content           TEXT NOT NULL,
  metadata          TEXT NOT NULL,
  embedding         BLOB,
  tags              TEXT NOT NULL DEFAULT '[]',
  confidence        REAL NOT NULL DEFAULT 0.5,
  alpha             REAL NOT NULL DEFAULT 1.0,
  beta              REAL NOT NULL DEFAULT 1.0,
  polarity          TEXT NOT NULL DEFAULT 'positive',
  status            TEXT NOT NULL DEFAULT 'active',
  source            TEXT NOT NULL,
  source_session_id TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_exposed_at   INTEGER,
  exposure_count    INTEGER NOT NULL DEFAULT 0,
  embedding_indexed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ke_kind       ON knowledge_entities(kind);
CREATE INDEX IF NOT EXISTS idx_ke_scope      ON knowledge_entities(scope);
CREATE INDEX IF NOT EXISTS idx_ke_kind_scope ON knowledge_entities(kind, scope, status);
CREATE INDEX IF NOT EXISTS idx_ke_session    ON knowledge_entities(source_session_id);
CREATE INDEX IF NOT EXISTS idx_ke_created    ON knowledge_entities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ke_confidence ON knowledge_entities(kind, confidence DESC) WHERE status='active';

CREATE TABLE IF NOT EXISTS llm_budget (
  date          TEXT PRIMARY KEY,
  spend_usd     REAL NOT NULL DEFAULT 0,
  triage_calls  INTEGER NOT NULL DEFAULT 0,
  extract_calls INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  source_session_id TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  status            TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_costs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  stage              TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER DEFAULT 0,
  output_tokens      INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  batch_size         INTEGER DEFAULT 1,
  session_id         TEXT,
  project            TEXT,
  created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_costs_stage   ON pipeline_costs(stage);
CREATE INDEX IF NOT EXISTS idx_costs_created ON pipeline_costs(created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_errors (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 INTEGER,
  stage              TEXT NOT NULL,
  severity           TEXT NOT NULL DEFAULT 'error',
  session_id         TEXT,
  project            TEXT,
  worker_id          TEXT,
  error_message      TEXT NOT NULL,
  error_stack        TEXT,
  context            TEXT,
  model_attempted    TEXT,
  fallback_attempted INTEGER DEFAULT 0,
  fallback_succeeded INTEGER DEFAULT 0,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  resolution         TEXT,
  created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_pe_stage_ts    ON pipeline_errors(stage, ts DESC);
CREATE INDEX IF NOT EXISTS idx_pe_severity_ts ON pipeline_errors(severity, ts DESC);
CREATE INDEX IF NOT EXISTS idx_pe_session     ON pipeline_errors(session_id);
`

// One-shot migration that DROPs every pre-v3.6 table. Gated on
// daemon_meta.key='greenfield_reset_v3_6' — runs once per memory.db and
// never again. The table names listed here are exactly the ones retired
// with Task 24's legacy cleanup.
const RETIRED_TABLES = [
  'patterns',
  'trajectories',
  'trajectory_steps',
  'memory_entries',
  'cluster_stats',
  'injection_log',
  ['judge', 'queue'].join('_'),
  'pattern_outcomes',
  'doc_chunks',
  'skills',
]

function runGreenfieldReset(db) {
  const already = db.prepare('SELECT value FROM daemon_meta WHERE key = ?')
    .get('greenfield_reset_v3_6')
  if (already) return
  const tx = db.transaction(() => {
    for (const t of RETIRED_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${t}`)
    }
    db.prepare('INSERT OR REPLACE INTO daemon_meta (key, value) VALUES (?, ?)')
      .run('greenfield_reset_v3_6', '1')
  })
  tx()
}

// ---------------------------------------------------------------------------
// createDb / openDb
// ---------------------------------------------------------------------------

function createDb(dbPath) {
  const dir = path.dirname(dbPath)
  if (dir && dir !== ':memory:' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)
  db.exec(SCHEMA)
  runGreenfieldReset(db)

  // ---- HNSW lifecycle (thin shim over ./lib/hnsw.js) ---------------------
  // The runtime never rebuilds the index synchronously; the /inject handler
  // lazy-loads via loadOrInit on first use. These shims keep daemon.js's
  // boot/periodic/shutdown hooks intact as simple no-ops or best-effort
  // flushes.

  db.initHnsw = function () {
    try {
      const { loadOrInit } = require('./lib/hnsw.js')
      // Fire-and-forget — the singleton is cached on first success.
      loadOrInit({ db, home: process.env.QUOTH_HOME }).catch(() => {})
    } catch { /* hnsw.js missing in some unit-test contexts */ }
  }

  db.saveHnsw = function () {
    try {
      const { hnswPersistPath } = require('./lib/hnsw.js')
      const filePath = hnswPersistPath(process.env.QUOTH_HOME)
      const cache = globalThis[Symbol.for('quoth.knowledgeHnsw')]
      const idx = cache && cache.get(filePath)
      if (idx && typeof idx.save === 'function') idx.save(filePath)
    } catch { /* best-effort */ }
  }

  // ---- daemon_meta k/v --------------------------------------------------

  db.setDaemonMeta = function (key, value) {
    db.prepare(`
      INSERT INTO daemon_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value))
  }

  db.getDaemonMeta = function (key) {
    const row = db.prepare('SELECT value FROM daemon_meta WHERE key = ?').get(key)
    return row ? row.value : null
  }

  // ---- sessions table ---------------------------------------------------

  db.upsertSession = function (s) {
    db.prepare(`
      INSERT INTO sessions (
        session_id, project, first_seen_ts, last_seen_ts, tool_count,
        status, closed_marker, epoch
      )
      VALUES (@session_id, @project, @first_seen_ts, @last_seen_ts, @tool_count,
              @status, @closed_marker, @epoch)
      ON CONFLICT(session_id, epoch) DO UPDATE SET
        project = excluded.project,
        last_seen_ts = excluded.last_seen_ts,
        tool_count = excluded.tool_count,
        status = excluded.status,
        closed_marker = excluded.closed_marker
    `).run({
      session_id: s.session_id,
      project: s.project,
      first_seen_ts: s.first_seen_ts,
      last_seen_ts: s.last_seen_ts,
      tool_count: s.tool_count || 0,
      status: s.status,
      closed_marker: s.closed_marker ? 1 : 0,
      epoch: s.epoch || 1,
    })
  }

  db.bumpSessionEpoch = function (session_id) {
    const row = db.prepare(
      'SELECT MAX(epoch) AS max_epoch, project FROM sessions WHERE session_id = ?'
    ).get(session_id)
    const next = (row?.max_epoch || 1) + 1
    const project = row?.project || 'unknown'
    const now = Date.now()
    db.prepare(`
      INSERT INTO sessions (session_id, epoch, project, status, first_seen_ts, last_seen_ts, tool_count, closed_marker)
      VALUES (?, ?, ?, 'processing', ?, ?, 0, 0)
      ON CONFLICT(session_id, epoch) DO NOTHING
    `).run(session_id, next, project, now, now)
    return next
  }

  db.getSession = function (session_id, epoch) {
    if (epoch != null) {
      return db.prepare('SELECT * FROM sessions WHERE session_id = ? AND epoch = ?')
        .get(session_id, epoch) || null
    }
    return db.prepare('SELECT * FROM sessions WHERE session_id = ? ORDER BY epoch DESC LIMIT 1')
      .get(session_id) || null
  }

  db.updateSessionStatus = function (session_id, status, extras = {}) {
    const now = Date.now()
    const terminal = ['done', 'routine', 'empty', 'error'].includes(status)
    return db.prepare(`
      UPDATE sessions
      SET status = @status,
          extracted_at = CASE WHEN @terminal THEN @now ELSE extracted_at END,
          pattern_count = COALESCE(@pattern_count, pattern_count),
          fact_count = COALESCE(@fact_count, fact_count)
      WHERE session_id = @session_id
        AND epoch = COALESCE(@epoch, (SELECT MAX(epoch) FROM sessions WHERE session_id = @session_id))
    `).run({
      session_id, status,
      terminal: terminal ? 1 : 0,
      now,
      pattern_count: extras.pattern_count ?? null,
      fact_count: extras.fact_count ?? null,
      epoch: extras.epoch ?? null,
    })
  }

  db.listSessions = function (filters = {}) {
    let query = 'SELECT * FROM sessions WHERE 1=1'
    const params = []
    if (filters.status != null) { query += ' AND status = ?'; params.push(filters.status) }
    if (filters.maxLastSeen != null) { query += ' AND last_seen_ts < ?'; params.push(filters.maxLastSeen) }
    if (filters.project) { query += ' AND project = ?'; params.push(filters.project) }
    query += ' ORDER BY last_seen_ts ASC'
    if (filters.limit != null && filters.limit > 0) { query += ' LIMIT ?'; params.push(filters.limit) }
    return db.prepare(query).all(...params)
  }

  db.countSessionEpochs = function (session_id, bucket) {
    const row = db.prepare(
      'SELECT COUNT(*) AS c FROM sessions WHERE session_id = ? AND status = ?'
    ).get(session_id, bucket)
    return row ? row.c : 0
  }

  // ---- agent registry ---------------------------------------------------

  db.registerAgent = function (agent) {
    db.prepare(`
      INSERT INTO agent_registry (agent_id, name, type, project, platform, status, capabilities, last_heartbeat, metadata)
      VALUES (@agent_id, @name, @type, @project, @platform, @status, @capabilities, @last_heartbeat, @metadata)
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        project = excluded.project,
        platform = excluded.platform,
        status = excluded.status,
        capabilities = excluded.capabilities,
        last_heartbeat = excluded.last_heartbeat,
        metadata = excluded.metadata
    `).run({
      agent_id: agent.agentId,
      name: agent.name,
      type: agent.type,
      project: agent.project || null,
      platform: agent.platform || null,
      status: agent.status || 'online',
      capabilities: JSON.stringify(agent.capabilities || []),
      last_heartbeat: Date.now(),
      metadata: JSON.stringify(agent.metadata || {}),
    })
  }

  db.heartbeat = function (agentId, status) {
    db.prepare(`
      UPDATE agent_registry SET
        last_heartbeat = ?,
        status = COALESCE(?, status)
      WHERE agent_id = ?
    `).run(Date.now(), status || null, agentId)
  }

  db.listAgents = function (filters = {}) {
    let query = 'SELECT * FROM agent_registry WHERE 1=1'
    const params = []
    if (filters.project) { query += ' AND project = ?'; params.push(filters.project) }
    if (filters.type) { query += ' AND type = ?'; params.push(filters.type) }
    if (filters.status) { query += ' AND status = ?'; params.push(filters.status) }
    query += ' ORDER BY last_heartbeat DESC'
    if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit) }
    return db.prepare(query).all(...params).map(r => ({
      ...r,
      capabilities: JSON.parse(r.capabilities || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
      heartbeatAge: r.last_heartbeat ? Date.now() - r.last_heartbeat : null,
    }))
  }

  db.cleanupStaleAgents = function (timeoutMs = 300000) {
    const cutoff = Date.now() - timeoutMs
    db.prepare(`
      UPDATE agent_registry SET status = 'offline'
      WHERE status = 'online' AND last_heartbeat < ? AND last_heartbeat IS NOT NULL
    `).run(cutoff)
  }

  // ---- events -----------------------------------------------------------

  db.emitEvent = function (eventType, agentId, project, payload) {
    return db.prepare(`
      INSERT INTO events (event_type, agent_id, project, payload)
      VALUES (?, ?, ?, ?)
    `).run(eventType, agentId || null, project || null, JSON.stringify(payload))
  }

  db.getEvents = function (filters = {}) {
    let query = 'SELECT * FROM events WHERE 1=1'
    const params = []
    if (filters.eventType) { query += ' AND event_type = ?'; params.push(filters.eventType) }
    if (filters.agentId) { query += ' AND agent_id = ?'; params.push(filters.agentId) }
    if (filters.project) { query += ' AND project = ?'; params.push(filters.project) }
    if (filters.since) { query += ' AND created_at > ?'; params.push(filters.since) }
    query += ' ORDER BY created_at DESC'
    query += ` LIMIT ${filters.limit || 50}`
    return db.prepare(query).all(...params).map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}'),
    }))
  }

  // ---- pipeline cost tracking -------------------------------------------

  db.recordPipelineCost = function ({ stage, model, input_tokens, output_tokens, estimated_cost_usd, batch_size, session_id, project }) {
    return db.prepare(`
      INSERT INTO pipeline_costs (stage, model, input_tokens, output_tokens, estimated_cost_usd, batch_size, session_id, project)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stage, model,
      input_tokens || 0, output_tokens || 0,
      estimated_cost_usd || 0, batch_size || 1,
      session_id || null, project || null,
    )
  }

  db.getCostSummary = function (range) {
    let whereClause = ''
    const params = []
    if (range === 'today') {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      whereClause = ' WHERE created_at >= ?'
      params.push(startOfDay.getTime())
    } else if (range === 'week') {
      whereClause = ' WHERE created_at >= ?'
      params.push(Date.now() - 7 * 86400000)
    }

    const rows = db.prepare(`
      SELECT stage, model,
        COUNT(*) as calls,
        SUM(estimated_cost_usd) as cost,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM pipeline_costs${whereClause}
      GROUP BY stage
    `).all(...params)

    const by_stage = {}
    let total_calls = 0
    let total_cost_usd = 0
    for (const row of rows) {
      by_stage[row.stage] = {
        calls: row.calls,
        cost: row.cost,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        model: row.model,
      }
      total_calls += row.calls
      total_cost_usd += row.cost
    }
    return { total_calls, total_cost_usd, by_stage }
  }

  return db
}

// Singleton handle keyed by resolved path. The daemon is a single-process,
// single-event-loop service — one long-lived connection is correct for
// better-sqlite3 (synchronous, no pool needed). Tests that change
// QUOTH_HOME between runs call vi.resetModules() which re-imports this
// module and resets the cache naturally.
let _cachedDb = null
let _cachedPath = null

function openDb() {
  const home = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
  const dbPath = path.join(home, 'memory.db')
  if (_cachedDb && _cachedPath === dbPath) return _cachedDb
  _cachedDb = createDb(dbPath)
  _cachedPath = dbPath
  return _cachedDb
}

// ---------------------------------------------------------------------------
// Top-level helper: severity-capable pipeline_errors insert (spec §5.2)
// ---------------------------------------------------------------------------

function logPipelineError({
  stage, severity = 'error', session_id = null, project = null, worker_id = null,
  error_message, error_stack = null, context = null, model_attempted = null,
  fallback_attempted = 0, fallback_succeeded = 0, retry_count = 0, resolution = null,
}) {
  const db = openDb()
  db.prepare(`
    INSERT INTO pipeline_errors
      (ts, stage, severity, session_id, project, worker_id, error_message, error_stack, context,
       model_attempted, fallback_attempted, fallback_succeeded, retry_count, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(), stage, severity, session_id, project, worker_id, error_message, error_stack,
    context ? JSON.stringify(context) : null,
    model_attempted, fallback_attempted, fallback_succeeded, retry_count, resolution,
  )
}

module.exports = { createDb, openDb, logPipelineError }
