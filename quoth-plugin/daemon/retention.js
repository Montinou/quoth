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

module.exports = { runRetentionSweep, getTtls }
