'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const DAY_MS = 24 * 60 * 60 * 1000
const NEVER_TOUCH = new Set(['active', 'processing', 'migrated-legacy'])

function envDays(key, defaultDays) {
  const raw = process.env[key]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : defaultDays
}

function getTtls() {
  return {
    done:    envDays('QUOTH_RETENTION_DONE_DAYS', 30),
    routine: envDays('QUOTH_RETENTION_ROUTINE_DAYS', 7),
    empty:   envDays('QUOTH_RETENTION_EMPTY_DAYS', 3),
    error:   envDays('QUOTH_RETENTION_ERROR_DAYS', 14),
  }
}

/**
 * Walk trajectories/<bucket>/** and delete any .jsonl + .meta.json pair
 * whose mtime is older than the bucket's configured TTL.
 */
function runRetentionSweep({ home = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), log = () => {} } = {}) {
  const trajDir = path.join(home, 'trajectories')
  const ttls = getTtls()
  const now = Date.now()
  const deleted = { done: 0, routine: 0, empty: 0, error: 0 }

  for (const bucket of Object.keys(ttls)) {
    const bucketDir = path.join(trajDir, bucket)
    if (!fs.existsSync(bucketDir)) continue
    const cutoffMs = ttls[bucket] * DAY_MS
    deleted[bucket] = sweepDir(bucketDir, now, cutoffMs, log)
  }

  log('info', 'retention_sweep', deleted)
  return { deleted, ttls }
}

function sweepDir(dir, now, cutoffMs, log) {
  let count = 0
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (NEVER_TOUCH.has(entry.name)) continue
    if (entry.isDirectory()) {
      count += sweepDir(fullPath, now, cutoffMs, log)
      // Remove empty subdirs after sweep (cleans up done/2026-03-01/quoth/ when all sessions expire).
      try {
        const remaining = fs.readdirSync(fullPath)
        if (remaining.length === 0) fs.rmdirSync(fullPath)
      } catch {}
      continue
    }
    if (!entry.name.endsWith('.jsonl')) continue

    let stat
    try { stat = fs.statSync(fullPath) } catch { continue }
    if (now - stat.mtimeMs < cutoffMs) continue

    // Delete jsonl + sidecar pair.
    try { fs.unlinkSync(fullPath) } catch {}
    const sidecar = fullPath.replace(/\.jsonl$/, '.meta.json')
    try { fs.unlinkSync(sidecar) } catch {}
    count++
  }

  return count
}

/**
 * HNSW catch-up sweep (spec §5.8).
 *
 * Walks `knowledge_entities WHERE embedding_indexed = 0` in bounded batches,
 * adds each vector to the shared HNSW singleton, marks it indexed, and
 * persists the index at the end. Runs at boot and nightly so rows that
 * landed in SQLite but never made it into the graph (crash, transient HNSW
 * failure) are healed without rebuilding from scratch.
 */
async function runHnswCatchUp({ batchSize, home = process.env.QUOTH_HOME } = {}) {
  const hnswMod = require('./lib/hnsw.js')
  const { listUnindexed, markIndexed } = require('./lib/knowledge-entities.js')

  const idx = await hnswMod.loadOrInit({ home })
  const envBatch = Number(process.env.QUOTH_HNSW_REBUILD_BATCH)
  const limit = Number.isFinite(batchSize) && batchSize > 0
    ? batchSize
    : (Number.isFinite(envBatch) && envBatch > 0 ? envBatch : 500)

  let added = 0
  // Bound the outer loop defensively — a row that can't be decoded would
  // otherwise spin forever since markIndexed is only called on success.
  // We skip-and-track unresolvable ids so the sweep terminates.
  const skipped = new Set()

  /* eslint-disable no-constant-condition */
  while (true) {
    const rows = listUnindexed(limit)
    if (rows.length === 0) break

    let progress = 0
    for (const row of rows) {
      if (skipped.has(row.id)) continue
      const vec = hnswMod.decodeEmbedding(row.embedding)
      if (!vec || vec.length !== idx.dimensions) {
        skipped.add(row.id)
        continue
      }
      try {
        idx.add(row.id, vec)
        markIndexed(row.id)
        added++
        progress++
      } catch {
        skipped.add(row.id)
      }
    }

    if (progress === 0) break // nothing indexable remains in this batch window
  }
  /* eslint-enable no-constant-condition */

  if (added > 0) {
    try { idx.save(hnswMod.hnswPersistPath(home)) } catch { /* best-effort */ }
  }

  return { added, skipped: skipped.size }
}

module.exports = { runRetentionSweep, getTtls, runHnswCatchUp }
