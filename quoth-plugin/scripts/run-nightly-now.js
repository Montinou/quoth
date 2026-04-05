#!/usr/bin/env node
/**
 * Force-run the nightly pipeline NOW instead of waiting until 03:00 ART.
 * Runs phases A-G (v1 + v2) against the live DB.
 *
 * Set flags via env:
 *   QUOTH_V2_INJECTION=true
 *   QUOTH_V2_CURATION=true
 *   QUOTH_V2_JUDGE=true
 *   QUOTH_JUDGE_DAILY_LIMIT=10   (cost cap)
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// Load .env like the daemon does
const projectRoot = path.join(__dirname, '..', '..')
for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(projectRoot, envFile)
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const stripped = line.replace(/\s+#.*$/, '')
      const m = stripped.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  } catch {}
}

const { createDb } = require('../daemon/db.js')
const flags = require('../daemon/lib/flags.js')

const dbPath = path.join(os.homedir(), '.quoth', 'memory.db')
const db = createDb(dbPath)

function log(level, msg, data) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, data ? JSON.stringify(data) : '')
}

async function rebuildClusters() {
  const { clusterPatterns } = require('../daemon/lib/clustering.js')
  const namespaces = db.prepare("SELECT DISTINCT namespace FROM patterns WHERE status='active'").all()
  for (const { namespace } of namespaces) {
    const rows = db.prepare(`
      SELECT id, embedding FROM patterns
      WHERE status='active' AND namespace = ? AND embedding IS NOT NULL
    `).all(namespace)
    const patterns = rows.map(p => {
      try { return { id: p.id, embedding: JSON.parse(p.embedding) } } catch { return null }
    }).filter(Boolean)
    if (patterns.length < 10) continue
    const K = Math.min(50, Math.max(3, Math.floor(Math.sqrt(patterns.length))))
    const { clusters, assignments } = clusterPatterns(patterns, K, { maxIter: 30 })
    if (clusters.length === 0) continue
    const tx = db.transaction(() => {
      for (const a of assignments) db.assignPatternCluster(a.patternId, a.cluster)
      for (const c of clusters) db.upsertClusterStats(c.id, namespace, c.centroid, c.memberCount)
    })
    tx()
    log('info', 'Cluster rebuild', { namespace, K, patterns: patterns.length, clusters: clusters.length })
  }
}

async function updateClusterPosteriors() {
  const { snipsEstimate } = require('../daemon/lib/snips.js')
  const completed = db.prepare(`
    SELECT cluster_id, namespace, reward, propensity FROM injection_log
    WHERE outcome_at IS NOT NULL AND reward IS NOT NULL AND cluster_id IS NOT NULL
      AND injected_at > (strftime('%s','now') - 86400*7) * 1000
  `).all()
  if (completed.length === 0) { log('info', 'SNIPS: no completed observations yet'); return }
  const byCluster = new Map()
  for (const row of completed) {
    const key = `${row.namespace}::${row.cluster_id}`
    if (!byCluster.has(key)) byCluster.set(key, [])
    byCluster.get(key).push({ reward: row.reward, propensity: row.propensity })
  }
  let updated = 0
  const tx = db.transaction(() => {
    for (const [key, obs] of byCluster.entries()) {
      if (obs.length < 3) continue
      const [ns, cid] = key.split('::')
      const estimate = snipsEstimate(obs)
      const n = Math.min(obs.length, 10)
      db.prepare(`
        UPDATE cluster_stats SET
          alpha = alpha + ?, beta = beta + ?, attempts = attempts + ?,
          updated_at = strftime('%s','now') * 1000
        WHERE cluster_id = ? AND namespace = ?
      `).run(n * estimate, n * (1 - estimate), obs.length, parseInt(cid), ns)
      updated++
    }
  })
  tx()
  log('info', 'Cluster posteriors updated via SNIPS', { clusters: updated, observations: completed.length })
}

async function enqueueJudgePairs() {
  const { selectUncertainPairs } = require('../daemon/lib/judge.js')
  const clusters = db.prepare("SELECT cluster_id, alpha, beta, namespace FROM cluster_stats").all()
  const pairs = selectUncertainPairs(clusters, { maxPairs: 20, widthThreshold: 0.3 })
  let enqueued = 0
  for (const p of pairs) {
    const patA = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.a.cluster_id)
    const patB = db.prepare("SELECT id FROM patterns WHERE cluster_id=? AND status='active' ORDER BY confidence DESC LIMIT 1").get(p.b.cluster_id)
    if (!patA || !patB) continue
    db.prepare(`
      INSERT INTO judge_queue (session_id, pattern_a_id, pattern_b_id, trajectory_summary, priority)
      VALUES ('v2-cluster-uncertainty', ?, ?, ?, ?)
    `).run(patA.id, patB.id, `Cluster uncertainty: c${p.a.cluster_id} vs c${p.b.cluster_id}`, 0.7)
    enqueued++
  }
  if (enqueued > 0) log('info', 'Judge pairs enqueued', { enqueued })
  return enqueued
}

async function runJudgeBatch() {
  const { buildPairwisePrompt, callJudge, parseJudgeVerdict } = require('../daemon/lib/judge.js')
  const maxBatch = parseInt(process.env.QUOTH_JUDGE_DAILY_LIMIT || '10', 10)
  const pending = db.prepare(`
    SELECT id, session_id, pattern_a_id, pattern_b_id, trajectory_summary
    FROM judge_queue WHERE status='pending' ORDER BY priority DESC LIMIT ?
  `).all(maxBatch)
  let judged = 0, failed = 0
  for (const item of pending) {
    const a = db.prepare('SELECT * FROM patterns WHERE id=?').get(item.pattern_a_id)
    const b = db.prepare('SELECT * FROM patterns WHERE id=?').get(item.pattern_b_id)
    if (!a || !b) {
      db.prepare("UPDATE judge_queue SET status='skipped' WHERE id=?").run(item.id)
      continue
    }
    const { prompt, positionMap } = buildPairwisePrompt(item.trajectory_summary || '', a, b)
    process.stdout.write(`    judging ${a.id.slice(0,8)} vs ${b.id.slice(0,8)}... `)
    const raw = await callJudge(prompt)
    if (!raw) {
      console.log('FAIL')
      db.prepare("UPDATE judge_queue SET status='failed' WHERE id=?").run(item.id)
      failed++
      continue
    }
    const verdict = parseJudgeVerdict(raw, positionMap)
    console.log(`→ ${verdict.slice(0,14)}`)
    db.prepare(`
      UPDATE judge_queue SET status='judged', verdict=?, judged_at=strftime('%s','now')*1000, cost_cents=0.03
      WHERE id=?
    `).run(verdict, item.id)
    if (verdict === item.pattern_a_id) {
      db.prepare('UPDATE patterns SET alpha = alpha + 0.5 WHERE id=?').run(item.pattern_a_id)
      db.prepare('UPDATE patterns SET beta = beta + 0.5 WHERE id=?').run(item.pattern_b_id)
    } else if (verdict === item.pattern_b_id) {
      db.prepare('UPDATE patterns SET alpha = alpha + 0.5 WHERE id=?').run(item.pattern_b_id)
      db.prepare('UPDATE patterns SET beta = beta + 0.5 WHERE id=?').run(item.pattern_a_id)
    }
    judged++
  }
  log('info', 'Judge batch complete', { judged, failed, skipped: pending.length - judged - failed })
}

async function runCuration() {
  const { backfillDistinctiveness, findNearDuplicates, enqueueDedupPairs, retirePoorPatterns } = require('../daemon/lib/curation.js')
  const n = backfillDistinctiveness(db)
  log('info', 'Distinctiveness recomputed', { patterns: n })
  // Force weekly (normally Sunday)
  const dups = findNearDuplicates(db, 0.92)
  if (dups.length > 0) {
    const enq = enqueueDedupPairs(db, dups)
    log('info', 'Dedup pairs enqueued', { pairs: enq })
  } else {
    log('info', 'No near-duplicates found at cosine>=0.92')
  }
  const retired = retirePoorPatterns(db, { ciUpperThreshold: 0.4, stalenessDays: 90, minAttempts: 20 })
  log('info', 'Retirement pass', { retired })
}

async function main() {
  const start = Date.now()
  log('info', '═══ Force-running nightly pipeline ═══', {
    injection: flags.isSubFlag('injection'),
    judge: flags.isSubFlag('judge'),
    curation: flags.isSubFlag('curation'),
  })

  if (flags.isSubFlag('injection')) {
    try { await rebuildClusters() } catch (e) { log('error', 'Phase D failed', { err: e.message }) }
    try { await updateClusterPosteriors() } catch (e) { log('error', 'Phase E failed', { err: e.message }) }
  }

  if (flags.isSubFlag('judge')) {
    try {
      await enqueueJudgePairs()
      await runJudgeBatch()
    } catch (e) { log('error', 'Phase F failed', { err: e.message, stack: e.stack }) }
  }

  if (flags.isSubFlag('curation')) {
    try { await runCuration() } catch (e) { log('error', 'Phase G failed', { err: e.message }) }
  }

  const elapsed = Math.round((Date.now() - start) / 1000)
  log('info', `═══ Pipeline complete in ${elapsed}s ═══`)

  // Final stats
  const clusters = db.prepare('SELECT COUNT(*) c FROM cluster_stats').get()
  const injections = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN is_exploration=1 THEN 1 ELSE 0 END) expl FROM injection_log").get()
  const judged = db.prepare("SELECT COUNT(*) c FROM judge_queue WHERE status='judged'").get()
  const retired = db.prepare("SELECT COUNT(*) c FROM patterns WHERE retired_at IS NOT NULL").get()
  console.log('\n═══ State snapshot ═══')
  console.log(`  clusters:         ${clusters.c}`)
  console.log(`  injections:       ${injections.total} (${injections.expl || 0} exploration)`)
  console.log(`  judged pairs:     ${judged.c}`)
  console.log(`  retired patterns: ${retired.c}`)
}

main().catch(err => { console.error(err); process.exit(1) })
