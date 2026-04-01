'use strict'

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'code-pattern',
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  confidence REAL DEFAULT 0.5,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  decay_rate REAL DEFAULT 0.005,
  embedding TEXT,
  version INTEGER DEFAULT 1,
  tags TEXT DEFAULT '[]',
  source TEXT DEFAULT 'distilled',
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  last_matched_at INTEGER
);

CREATE TABLE IF NOT EXISTS trajectories (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  status TEXT DEFAULT 'active',
  verdict TEXT,
  task TEXT,
  context TEXT,
  total_steps INTEGER DEFAULT 0,
  total_reward REAL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  ended_at INTEGER,
  extracted_pattern_id TEXT REFERENCES patterns(id)
);

CREATE TABLE IF NOT EXISTS trajectory_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trajectory_id TEXT NOT NULL REFERENCES trajectories(id),
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  observation TEXT,
  reward REAL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  type TEXT DEFAULT 'semantic',
  tags TEXT,
  metadata TEXT,
  access_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  last_accessed_at INTEGER,
  UNIQUE(namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
`

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

function createDb(dbPath) {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)
  db.exec(SCHEMA)

  // Runtime migration: add promotion tracking columns if not present
  const existingCols = db.prepare('PRAGMA table_info(patterns)').all().map(r => r.name)
  const promotionCols = [
    { name: 'promoted_at', type: 'INTEGER' },
    { name: 'cloud_document_id', type: 'TEXT' },
    { name: 'promoted_confidence', type: 'REAL' },
    { name: 'applicability', type: "TEXT DEFAULT 'narrow'" }
  ]
  for (const col of promotionCols) {
    if (!existingCols.includes(col.name)) {
      db.exec(`ALTER TABLE patterns ADD COLUMN ${col.name} ${col.type}`)
    }
  }

  db.upsertPattern = function(p) {
    db.prepare(`
      INSERT INTO patterns (id, name, pattern_type, condition, action, description,
        confidence, tags, source, status, embedding)
      VALUES (@id, @name, @pattern_type, @condition, @action, @description,
        @confidence, @tags, @source, @status, @embedding)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        condition = excluded.condition,
        action = excluded.action,
        description = excluded.description,
        confidence = excluded.confidence,
        tags = excluded.tags,
        source = excluded.source,
        embedding = COALESCE(excluded.embedding, patterns.embedding),
        updated_at = strftime('%s','now') * 1000
    `).run({
      id: p.id,
      name: p.name,
      pattern_type: p.pattern_type || 'code-pattern',
      condition: p.condition,
      action: p.action,
      description: p.description || null,
      confidence: p.confidence ?? 0.5,
      tags: JSON.stringify(p.tags || []),
      source: p.source || 'distilled',
      status: p.status || 'active',
      embedding: p.embedding || null
    })
  }

  db.getPattern = function(id) {
    const row = db.prepare('SELECT * FROM patterns WHERE id = ?').get(id)
    if (!row) return null
    return { ...row, tags: JSON.parse(row.tags || '[]') }
  }

  db.getTopPatterns = function(limit = 5, tags = []) {
    let query = `SELECT * FROM patterns WHERE status = 'active'`
    const params = []
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ')
      query += ` AND (${tagConditions})`
      tags.forEach(t => params.push(`%"${t}"%`))
    }
    query += ` ORDER BY confidence DESC LIMIT ?`
    params.push(limit)
    return db.prepare(query).all(...params).map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
  }

  db.searchBySimilarity = function(queryVector, limit = 5, tags = []) {
    let query = `SELECT * FROM patterns WHERE status = 'active' AND embedding IS NOT NULL`
    const params = []
    if (tags.length > 0) {
      const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ')
      query += ` AND (${tagConditions})`
      tags.forEach(t => params.push(`%"${t}"%`))
    }
    const rows = db.prepare(query).all(...params)
    if (rows.length === 0) return db.getTopPatterns(limit, tags)

    const scored = rows.map(row => {
      let sim = 0
      try { sim = cosineSimilarity(queryVector, JSON.parse(row.embedding)) } catch {}
      return { ...row, tags: JSON.parse(row.tags || '[]'), _similarity: sim }
    })
    scored.sort((a, b) => b._similarity - a._similarity)
    return scored.slice(0, limit)
  }

  db.applyConfidenceDelta = function(id, delta) {
    db.prepare(`
      UPDATE patterns
      SET confidence = MIN(1.0, MAX(0.0, confidence + ?)),
          success_count = CASE WHEN ? > 0 THEN success_count + 1 ELSE success_count END,
          failure_count = CASE WHEN ? < 0 THEN failure_count + 1 ELSE failure_count END,
          last_matched_at = strftime('%s','now') * 1000,
          updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(delta, delta, delta, id)
  }

  db.applyHourlyDecay = function() {
    db.prepare(`
      UPDATE patterns
      SET confidence = MAX(0.0, confidence - decay_rate),
          updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
    `).run()
  }

  db.archiveWeakPatterns = function() {
    db.prepare(`
      UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
      WHERE confidence < 0.1
        AND (success_count + failure_count) > 5
        AND status = 'active'
    `).run()
  }

  db.getPromotionCandidates = function() {
    return db.prepare(`
      SELECT * FROM patterns
      WHERE confidence > 0.8
        AND (success_count + failure_count) > 10
        AND status = 'active'
        AND source = 'distilled'
    `).all().map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
  }

  db.markPromoted = function(id, cloudDocumentId, confidence) {
    db.prepare(`
      UPDATE patterns SET
        promoted_at = strftime('%s','now') * 1000,
        cloud_document_id = ?,
        promoted_confidence = ?,
        updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(cloudDocumentId, confidence, id)
  }

  db.appendTrajectoryEntry = function(entry) {
    const id = `${entry.session}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    db.prepare(`
      INSERT OR IGNORE INTO trajectories (id, session_id, status, task, context)
      VALUES (?, ?, 'active', ?, ?)
    `).run(entry.session || id, entry.session || id, entry.task || null, JSON.stringify(entry))

    db.prepare(`
      INSERT INTO trajectory_steps (trajectory_id, step_number, action, observation, metadata)
      VALUES (?, (SELECT COUNT(*) + 1 FROM trajectory_steps WHERE trajectory_id = ?), ?, ?, ?)
    `).run(
      entry.session || id, entry.session || id,
      entry.event || 'agent_stop',
      entry.outcome || null,
      JSON.stringify(entry)
    )
  }

  db.getPendingTrajectoryEntries = function(limit = 50) {
    return db.prepare(`
      SELECT ts.*, t.session_id
      FROM trajectory_steps ts
      JOIN trajectories t ON t.id = ts.trajectory_id
      WHERE ts.metadata NOT LIKE '%"processed":true%'
      ORDER BY ts.created_at ASC
      LIMIT ?
    `).all(limit)
  }

  db.markStepProcessed = function(stepId) {
    const row = db.prepare('SELECT metadata FROM trajectory_steps WHERE id = ?').get(stepId)
    if (!row) return
    let meta = {}
    try { meta = JSON.parse(row.metadata || '{}') } catch {}
    meta.processed = true
    db.prepare('UPDATE trajectory_steps SET metadata = ? WHERE id = ?')
      .run(JSON.stringify(meta), stepId)
  }

  return db
}

module.exports = { createDb }
