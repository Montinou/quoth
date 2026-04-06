'use strict'

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { HnswIndex } = require('./lib/hnsw.js')
const { trigrams } = require('./lib/injection.js')

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

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  project TEXT,
  platform TEXT,
  status TEXT DEFAULT 'online',
  capabilities TEXT DEFAULT '[]',
  last_heartbeat INTEGER,
  registered_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  project TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

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

  // Runtime migration: add Bayesian scoring columns if not present
  const existingCols2 = db.prepare('PRAGMA table_info(patterns)').all().map(r => r.name)
  if (!existingCols2.includes('alpha')) {
    db.exec(`ALTER TABLE patterns ADD COLUMN alpha REAL DEFAULT 1`)
  }
  if (!existingCols2.includes('beta')) {
    db.exec(`ALTER TABLE patterns ADD COLUMN beta REAL DEFAULT 1`)
  }

  // Runtime migration: add namespace column for cross-project pattern sharing
  const cols4 = db.prepare('PRAGMA table_info(patterns)').all().map(r => r.name)
  if (!cols4.includes('namespace')) {
    db.exec("ALTER TABLE patterns ADD COLUMN namespace TEXT DEFAULT 'default'")
    db.exec("CREATE INDEX IF NOT EXISTS idx_patterns_namespace ON patterns(namespace)")
  }

  // Runtime migration: add exposure tracking + trigram caching columns
  try { db.prepare("ALTER TABLE patterns ADD COLUMN exposure_count INTEGER DEFAULT 0").run() } catch {}
  try { db.prepare("ALTER TABLE patterns ADD COLUMN last_exposed_at INTEGER").run() } catch {}
  try { db.prepare("ALTER TABLE patterns ADD COLUMN ignored_count INTEGER DEFAULT 0").run() } catch {}
  try { db.prepare("ALTER TABLE patterns ADD COLUMN embedding_text TEXT").run() } catch {}
  try { db.prepare("ALTER TABLE patterns ADD COLUMN pattern_trigrams TEXT").run() } catch {}
  try { db.prepare("ALTER TABLE patterns ADD COLUMN quality_history TEXT DEFAULT '[]'").run() } catch {}

  // V2 runtime migrations: hierarchical Thompson + curation columns
  // Helper: swallow "duplicate column" errors only (idempotency); log everything else.
  function v2Migrate(label, fn) {
    try { fn() } catch (e) {
      if (!/duplicate column|already exists/i.test(e.message)) {
        console.error(`[db v2 migration] ${label} failed:`, e.message)
        throw e
      }
    }
  }
  v2Migrate('add cluster_id', () => db.prepare("ALTER TABLE patterns ADD COLUMN cluster_id INTEGER DEFAULT NULL").run())
  v2Migrate('add cluster_rank_score', () => db.prepare("ALTER TABLE patterns ADD COLUMN cluster_rank_score REAL DEFAULT 0.5").run())
  v2Migrate('add effective_exposures', () => db.prepare("ALTER TABLE patterns ADD COLUMN effective_exposures REAL DEFAULT 0").run())
  v2Migrate('add distinctiveness', () => db.prepare("ALTER TABLE patterns ADD COLUMN distinctiveness REAL DEFAULT NULL").run())
  v2Migrate('add retired_at', () => db.prepare("ALTER TABLE patterns ADD COLUMN retired_at INTEGER DEFAULT NULL").run())
  v2Migrate('add retired_reason', () => db.prepare("ALTER TABLE patterns ADD COLUMN retired_reason TEXT DEFAULT NULL").run())
  v2Migrate('create idx_patterns_cluster', () => db.exec("CREATE INDEX IF NOT EXISTS idx_patterns_cluster ON patterns(cluster_id)"))

  // V2 auxiliary tables
  try {
    // Cluster ids are local per namespace (0..K-1), so PK must be compound.
    db.exec(`
      CREATE TABLE IF NOT EXISTS cluster_stats (
        cluster_id INTEGER NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        alpha REAL NOT NULL DEFAULT 1.0,
        beta REAL NOT NULL DEFAULT 1.0,
        attempts INTEGER NOT NULL DEFAULT 0,
        centroid_embedding TEXT,
        member_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        PRIMARY KEY (cluster_id, namespace)
      );
      CREATE INDEX IF NOT EXISTS idx_cluster_stats_ns ON cluster_stats(namespace);
    `)
    // One-time migration from legacy single-PK table: detect + rebuild if needed
    const pk = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cluster_stats'").get()
    if (pk && !/PRIMARY KEY \(cluster_id, namespace\)/i.test(pk.sql)) {
      console.error('[db v2] migrating cluster_stats to compound PK')
      db.exec(`
        ALTER TABLE cluster_stats RENAME TO cluster_stats_legacy;
        CREATE TABLE cluster_stats (
          cluster_id INTEGER NOT NULL,
          namespace TEXT NOT NULL DEFAULT 'default',
          alpha REAL NOT NULL DEFAULT 1.0,
          beta REAL NOT NULL DEFAULT 1.0,
          attempts INTEGER NOT NULL DEFAULT 0,
          centroid_embedding TEXT,
          member_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
          PRIMARY KEY (cluster_id, namespace)
        );
        INSERT INTO cluster_stats SELECT * FROM cluster_stats_legacy;
        DROP TABLE cluster_stats_legacy;
        CREATE INDEX IF NOT EXISTS idx_cluster_stats_ns ON cluster_stats(namespace);
      `)
    }
  } catch (e) { console.error('[db v2] table create failed:', e.message); throw e }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS injection_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        pattern_id TEXT NOT NULL,
        cluster_id INTEGER,
        rank INTEGER NOT NULL,
        propensity REAL NOT NULL,
        is_exploration INTEGER NOT NULL DEFAULT 0,
        query_text TEXT,
        injected_at INTEGER NOT NULL,
        outcome_at INTEGER,
        reward REAL
      );
      CREATE INDEX IF NOT EXISTS idx_injection_log_session ON injection_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_injection_log_pattern ON injection_log(pattern_id);
      CREATE INDEX IF NOT EXISTS idx_injection_log_pending ON injection_log(outcome_at) WHERE outcome_at IS NULL;
    `)
  } catch (e) { console.error('[db v2] table create failed:', e.message); throw e }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS judge_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        pattern_a_id TEXT NOT NULL,
        pattern_b_id TEXT NOT NULL,
        trajectory_summary TEXT,
        priority REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'pending',
        verdict TEXT,
        judged_at INTEGER,
        cost_cents REAL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_judge_queue_status ON judge_queue(status, priority DESC);
    `)
  } catch (e) { console.error('[db v2] judge_queue create failed:', e.message); throw e }

  // One-time repair: reset inflated beta values from old aggressive temporal decay.
  // The previous applyHourlyDecay() added beta +0.1/hour to never-matched patterns,
  // inflating beta to 9-13 in a few days. Reset never-exposed patterns to Beta(1,1).
  v2Migrate('repair inflated beta from temporal decay', () => {
    const repaired = db.prepare(`
      UPDATE patterns
      SET alpha = 1.0, beta = 1.0,
          confidence = 0.5,
          updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND exposure_count = 0
        AND (success_count + failure_count) = 0
        AND beta > 2.0
    `).run()
    if (repaired.changes > 0) {
      console.error(`[db v2] repaired ${repaired.changes} patterns with inflated beta (reset to Beta(1,1))`)
    }
  })

  // One-time backfill for existing patterns without trigrams
  try {
    const needsTrigrams = db.prepare(`
      SELECT id, name, action, condition FROM patterns
      WHERE pattern_trigrams IS NULL AND status = 'active'
    `).all()
    if (needsTrigrams.length > 0) {
      const update = db.prepare('UPDATE patterns SET pattern_trigrams = ? WHERE id = ?')
      const tx = db.transaction((rows) => {
        for (const r of rows) {
          const text = `${r.name || ''} ${r.action || ''} ${r.condition || ''}`
          update.run(JSON.stringify([...trigrams(text)]), r.id)
        }
      })
      tx(needsTrigrams)
    }
  } catch {}

  // --- HNSW index state ---
  const hnsw = new HnswIndex(1536)
  let hnswHealthy = false

  db.initHnsw = function() {
    try {
      const indexPath = path.join(path.dirname(dbPath), 'hnsw.index.json')
      if (fs.existsSync(indexPath)) {
        hnsw.load(indexPath)
        hnswHealthy = true
        return
      }
      hnsw.buildFromDb(db)
      hnswHealthy = true
      hnsw.save(indexPath)
    } catch(e) {
      hnswHealthy = false
      // Don't crash — linear scan fallback still works
    }
  }

  db.saveHnsw = function() {
    if (!hnswHealthy) return
    try {
      const indexPath = path.join(path.dirname(dbPath), 'hnsw.index.json')
      hnsw.save(indexPath)
    } catch {}
  }

  db.rebuildHnsw = function() {
    try {
      hnsw.buildFromDb(db)
      hnswHealthy = true
      db.saveHnsw()
    } catch { hnswHealthy = false }
  }

  // --- Dedup helpers ---
  db.findDuplicateByName = function(name, threshold = 0.8) {
    // Normalized prefix match: if two names share >80% of characters, they're dupes
    const normalized = (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (normalized.length < 10) return null
    const candidates = db.prepare(`
      SELECT id, name, confidence, alpha, beta FROM patterns
      WHERE status = 'active' AND length(name) > 10
      ORDER BY confidence DESC LIMIT 200
    `).all()
    for (const c of candidates) {
      const cNorm = (c.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
      if (cNorm.length < 10) continue
      // Check prefix overlap
      const shorter = Math.min(normalized.length, cNorm.length)
      const longer = Math.max(normalized.length, cNorm.length)
      let matchLen = 0
      for (let i = 0; i < shorter; i++) {
        if (normalized[i] === cNorm[i]) matchLen++
        else break
      }
      if (matchLen / longer >= threshold) return c
    }
    return null
  }

  db.findDuplicateByEmbedding = function(embedding, threshold = 0.92) {
    if (!embedding || !hnswHealthy || hnsw.size === 0) return null
    try {
      const vec = typeof embedding === 'string' ? JSON.parse(embedding) : embedding
      const candidates = hnsw.search(vec, 3)
      if (candidates.length === 0) return null
      // Get the closest match
      const best = candidates[0]
      const row = db.prepare('SELECT * FROM patterns WHERE id = ? AND status = ?').get(best.id, 'active')
      if (!row) return null
      const sim = cosineSimilarity(vec, JSON.parse(row.embedding))
      if (sim >= threshold) return { ...row, _similarity: sim }
      return null
    } catch { return null }
  }

  db.upsertPattern = function(p) {
    const textForTrigrams = `${p.name || ''} ${p.action || ''} ${p.condition || ''}`
    const patternTrigrams = JSON.stringify([...trigrams(textForTrigrams)])

    db.prepare(`
      INSERT INTO patterns (id, name, pattern_type, condition, action, description,
        confidence, tags, source, status, embedding, namespace, pattern_trigrams)
      VALUES (@id, @name, @pattern_type, @condition, @action, @description,
        @confidence, @tags, @source, @status, @embedding, @namespace, @pattern_trigrams)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        condition = excluded.condition,
        action = excluded.action,
        description = excluded.description,
        confidence = excluded.confidence,
        tags = excluded.tags,
        source = excluded.source,
        embedding = COALESCE(excluded.embedding, patterns.embedding),
        namespace = excluded.namespace,
        pattern_trigrams = excluded.pattern_trigrams,
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
      embedding: p.embedding || null,
      namespace: p.namespace || 'default',
      pattern_trigrams: patternTrigrams
    })

    if (p.embedding && hnswHealthy) {
      try {
        const vec = typeof p.embedding === 'string' ? JSON.parse(p.embedding) : p.embedding
        hnsw.add(p.id, vec)
      } catch {}
    }
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
    // Try HNSW first for fast approximate search
    if (hnswHealthy && hnsw.size > 0) {
      try {
        // Get more candidates than needed for post-filtering
        const candidates = hnsw.search(queryVector, limit * 3)
        if (candidates.length > 0) {
          const ids = candidates.map(c => c.id)
          const placeholders = ids.map(() => '?').join(',')
          let query = `SELECT * FROM patterns WHERE id IN (${placeholders}) AND status = 'active'`
          const params = [...ids]
          if (tags.length > 0) {
            const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ')
            query += ` AND (${tagConditions})`
            tags.forEach(t => params.push(`%"${t}"%`))
          }
          const rows = db.prepare(query).all(...params)
          // Re-score with exact cosine for final ranking
          const scored = rows.map(row => ({
            ...row,
            tags: JSON.parse(row.tags || '[]'),
            _similarity: cosineSimilarity(queryVector, JSON.parse(row.embedding))
          }))
          scored.sort((a, b) => b._similarity - a._similarity)
          if (scored.length > 0) return scored.slice(0, limit)
        }
      } catch {}
      // Fall through to linear scan on any HNSW error
    }

    // Linear scan fallback (original implementation)
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

  db.applyBayesianUpdate = function(id, outcome) {
    if (outcome === 'success') {
      db.prepare(`
        UPDATE patterns SET
          alpha = alpha + 1,
          success_count = success_count + 1,
          confidence = (alpha + 1.0) / (alpha + 1.0 + beta),
          last_matched_at = strftime('%s','now') * 1000,
          updated_at = strftime('%s','now') * 1000
        WHERE id = ?
      `).run(id)
    } else {
      db.prepare(`
        UPDATE patterns SET
          beta = beta + 1,
          failure_count = failure_count + 1,
          confidence = alpha / (alpha + beta + 1.0),
          last_matched_at = strftime('%s','now') * 1000,
          updated_at = strftime('%s','now') * 1000
        WHERE id = ?
      `).run(id)
    }
  }

  db.applyHourlyDecay = function() {
    // Exposure-based decay: only penalize patterns with actual performance data.
    // "No exposure = no data = no change." A Docker pattern shouldn't decay
    // just because the user hasn't done Docker work in weeks.
    //
    // Tier 1 (exposure-informed): Patterns exposed ≥5 times with <10% conversion.
    //   These had real chances and consistently failed to help. beta += 0.05/hour.
    //
    // Tier 2 (dominance prevention): Patterns with >20 exposures get very gentle
    //   alpha decay to prevent old winners from dominating forever.
    //   alpha *= 0.9995/hour ≈ -0.35%/week. Only affects high-exposure patterns.
    //
    // Never-exposed patterns: NO decay. Their confidence stays at creation value
    // until they get injected and we have real signal. Cleanup of truly stale
    // never-exposed patterns is handled by archiveWeakPatterns() instead.

    // Tier 1: Exposed but unhelpful — poor conversion rate with enough data
    db.prepare(`
      UPDATE patterns
      SET beta = beta + 0.05,
          confidence = MAX(0.05, alpha / (alpha + beta + 0.05)),
          updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND exposure_count >= 5
        AND (success_count * 1.0 / MAX(exposure_count, 1)) < 0.1
    `).run()

    // Tier 2: High-exposure dominance prevention — very gentle alpha decay
    // alpha *= 0.9995/hour ≈ 0.965 after 1 week (3.5% weekly reduction)
    db.prepare(`
      UPDATE patterns
      SET alpha = MAX(0.1, alpha * 0.9995),
          confidence = MAX(0.05, MAX(0.1, alpha * 0.9995) / (MAX(0.1, alpha * 0.9995) + beta)),
          updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND exposure_count > 20
    `).run()
  }

  db.archiveWeakPatterns = function() {
    // Archive patterns with enough exposure data that proved unhelpful
    // (≥10 exposures, <5% conversion, low confidence)
    db.prepare(`
      UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND confidence < 0.1
        AND exposure_count >= 10
        AND (success_count * 1.0 / MAX(exposure_count, 1)) < 0.05
    `).run()

    // Archive raw tool-call patterns that never got feedback (noise from distiller)
    db.prepare(`
      UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND confidence < 0.15
        AND (success_count + failure_count) = 0
        AND (name LIKE 'claude-code: Bash %' OR name LIKE 'claude-code: Write /%'
             OR name LIKE 'claude-code: Edit /%' OR name LIKE 'claude-code: Read /%')
    `).run()

    // Archive patterns older than 90 days that were never exposed (truly irrelevant)
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000)
    db.prepare(`
      UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
      WHERE status = 'active'
        AND exposure_count = 0
        AND (success_count + failure_count) = 0
        AND created_at < ?
    `).run(ninetyDaysAgo)
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

  db.getProjectPatterns = function(namespace, limit = 10) {
    return db.prepare(`
      SELECT * FROM patterns
      WHERE status = 'active' AND (namespace = ? OR namespace = 'global')
      ORDER BY confidence DESC LIMIT ?
    `).all(namespace, limit).map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
  }

  db.promoteToGlobal = function(id) {
    db.prepare(`
      UPDATE patterns SET namespace = 'global', updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(id)
  }

  db.setPatternNamespace = function(id, namespace) {
    db.prepare(`
      UPDATE patterns SET namespace = ?, updated_at = strftime('%s','now') * 1000
      WHERE id = ?
    `).run(namespace, id)
  }

  // --- V2: Cluster-level stats + injection logging + judge queue ---

  db.assignPatternCluster = function(patternId, clusterId) {
    db.prepare('UPDATE patterns SET cluster_id = ? WHERE id = ?').run(clusterId, patternId)
  }

  db.upsertClusterStats = function(cid, namespace, centroid, memberCount) {
    db.prepare(`
      INSERT INTO cluster_stats (cluster_id, namespace, centroid_embedding, member_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cluster_id, namespace) DO UPDATE SET
        centroid_embedding = excluded.centroid_embedding,
        member_count = excluded.member_count,
        updated_at = strftime('%s','now') * 1000
    `).run(cid, namespace, JSON.stringify(centroid), memberCount)
  }

  db.getClusterStats = function(clusterId, namespace) {
    const r = namespace
      ? db.prepare('SELECT * FROM cluster_stats WHERE cluster_id = ? AND namespace = ?').get(clusterId, namespace)
      : db.prepare('SELECT * FROM cluster_stats WHERE cluster_id = ? LIMIT 1').get(clusterId)
    if (!r) return null
    let centroid = []
    try { centroid = JSON.parse(r.centroid_embedding || '[]') } catch {}
    return { ...r, centroid }
  }

  db.getAllClusterStats = function(namespace) {
    const rows = namespace
      ? db.prepare('SELECT * FROM cluster_stats WHERE namespace = ?').all(namespace)
      : db.prepare('SELECT * FROM cluster_stats').all()
    return rows
  }

  db.logInjection = function(entry) {
    db.prepare(`
      INSERT INTO injection_log
      (session_id, namespace, pattern_id, cluster_id, rank, propensity, is_exploration, query_text, injected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now') * 1000)
    `).run(
      entry.session_id, entry.namespace, entry.pattern_id, entry.cluster_id ?? null,
      entry.rank, entry.propensity, entry.is_exploration ? 1 : 0, entry.query_text || null
    )
  }

  db.updateInjectionOutcome = function(sessionId, patternId, reward) {
    db.prepare(`
      UPDATE injection_log
      SET outcome_at = strftime('%s','now') * 1000, reward = ?
      WHERE session_id = ? AND pattern_id = ? AND outcome_at IS NULL
    `).run(reward, sessionId, patternId)
  }

  db.getPendingInjections = function(olderThanMs = 3600000) {
    const cutoff = Date.now() - olderThanMs
    return db.prepare(`
      SELECT * FROM injection_log WHERE outcome_at IS NULL AND injected_at < ?
      ORDER BY injected_at ASC LIMIT 500
    `).all(cutoff)
  }

  db.getCompletedInjections = function(sinceMs = 0, limit = 5000) {
    return db.prepare(`
      SELECT * FROM injection_log
      WHERE outcome_at IS NOT NULL AND reward IS NOT NULL AND injected_at > ?
      ORDER BY injected_at DESC LIMIT ?
    `).all(sinceMs, limit)
  }

  // --- Agent Registry ---

  db.registerAgent = function(agent) {
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
      metadata: JSON.stringify(agent.metadata || {})
    })
  }

  db.heartbeat = function(agentId, status) {
    db.prepare(`
      UPDATE agent_registry SET
        last_heartbeat = ?,
        status = COALESCE(?, status)
      WHERE agent_id = ?
    `).run(Date.now(), status || null, agentId)
  }

  db.listAgents = function(filters = {}) {
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
      heartbeatAge: r.last_heartbeat ? Date.now() - r.last_heartbeat : null
    }))
  }

  db.cleanupStaleAgents = function(timeoutMs = 300000) {
    const cutoff = Date.now() - timeoutMs
    db.prepare(`
      UPDATE agent_registry SET status = 'offline'
      WHERE status = 'online' AND last_heartbeat < ? AND last_heartbeat IS NOT NULL
    `).run(cutoff)
  }

  // --- Event Sourcing ---

  db.emitEvent = function(eventType, agentId, project, payload) {
    return db.prepare(`
      INSERT INTO events (event_type, agent_id, project, payload)
      VALUES (?, ?, ?, ?)
    `).run(eventType, agentId || null, project || null, JSON.stringify(payload))
  }

  db.getEvents = function(filters = {}) {
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
      payload: JSON.parse(r.payload || '{}')
    }))
  }

  return db
}

module.exports = { createDb }
