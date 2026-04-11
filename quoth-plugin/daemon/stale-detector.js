'use strict'

const fs = require('fs')
const path = require('path')
const {
  moveSessionFile,
  updateSidecar,
} = require('./lib/sessions.js')

// Idle threshold: any active session whose sidecar last_seen_ts is older
// than this gets flushed to processing/. Per spec §6.4 this is the ONLY
// gate — no second-tier "trivial TTL" and no entry-count skip.
const STALE_TTL_MS = Number(process.env.QUOTH_STALE_TTL_MS || 30 * 60 * 1000) // 30 min

function noopLog() {}

/**
 * Read every sidecar under trajectories/active/ and upsert into the
 * sessions table so SQL is the source of truth for the detector.
 *
 * @returns {number} count of sidecars processed
 */
function syncActiveSessionsToDb(db, trajectoriesDir) {
  const activeDir = path.join(trajectoriesDir, 'active')
  let metaFiles
  try {
    metaFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.meta.json'))
  } catch {
    return 0
  }
  let count = 0
  for (const f of metaFiles) {
    try {
      const sid = f.replace(/\.meta\.json$/, '')
      const meta = JSON.parse(fs.readFileSync(path.join(activeDir, f), 'utf8'))
      db.upsertSession({
        session_id: sid,
        project: meta.project || 'default',
        first_seen_ts: meta.first_seen_ts || Date.now(),
        last_seen_ts: meta.last_seen_ts || Date.now(),
        tool_count: meta.tool_count || 0,
        status: 'active',
        closed_marker: meta.closed_marker ? 1 : 0,
        epoch: 1,
      })
      count++
    } catch {
      // Corrupt sidecar — skip silently.
    }
  }
  return count
}

/**
 * Flush abandoned active sessions to processing/.
 *
 * Flow:
 *   1. syncActiveSessionsToDb() — bring sessions table up to date.
 *   2. db.listSessions({ status: 'active', maxLastSeen: now - STALE_TTL_MS }).
 *   3. For each stale row: race-guard → sidecar patch → atomic rename → DB status update.
 *   4. db.setDaemonMeta('last_stale_scan_ts', now) — for startup catch-up.
 *
 * Test hooks (underscore prefix):
 *   - _raceSimulator() — called just before the mtime check
 *   - _onRaceAbort() — called when the race guard triggers
 */
function detectStaleSessions({
  db,
  trajectoriesDir,
  log = noopLog,
  _raceSimulator = null,
  _onRaceAbort = null,
} = {}) {
  const now = Date.now()

  try {
    syncActiveSessionsToDb(db, trajectoriesDir)
  } catch (err) {
    log('error', 'stale_sync_failed', { error: err.message })
  }

  const staleCutoff = now - STALE_TTL_MS
  let rows
  try {
    rows = db.listSessions({ status: 'active', maxLastSeen: staleCutoff }) || []
  } catch (err) {
    log('error', 'stale_query_failed', { error: err.message })
    try { db.setDaemonMeta('last_stale_scan_ts', String(now)) } catch {}
    return
  }

  const activeDir = path.join(trajectoriesDir, 'active')

  for (const row of rows) {
    const sid = row.session_id
    const jsonlPath = path.join(activeDir, `${sid}.jsonl`)
    const sidecarFile = path.join(activeDir, `${sid}.meta.json`)

    if (!fs.existsSync(jsonlPath)) continue

    if (typeof _raceSimulator === 'function') _raceSimulator()

    let sidecarMtime
    try {
      sidecarMtime = fs.statSync(sidecarFile).mtimeMs
    } catch {
      continue
    }
    if (sidecarMtime > row.last_seen_ts + 1000) {
      log('info', 'stale_race_abort', {
        sid,
        row_last_seen: row.last_seen_ts,
        sidecar_mtime: sidecarMtime,
      })
      if (typeof _onRaceAbort === 'function') _onRaceAbort()
      continue
    }

    try {
      updateSidecar(sidecarFile, {
        status: 'stale-flushed',
        stale_flushed_at: now,
      })
    } catch (err) {
      log('error', 'stale_sidecar_patch_failed', { sid, error: err.message })
      continue
    }

    try {
      moveSessionFile(jsonlPath, 'processing')
    } catch (err) {
      log('error', 'stale_rename_failed', { sid, error: err.message })
      continue
    }

    try {
      db.updateSessionStatus(sid, 'processing', { epoch: row.epoch })
    } catch (err) {
      log('warn', 'stale_row_status_update_failed', { sid, error: err.message })
    }

    log('info', 'stale_flushed_to_processing', {
      sid,
      tool_count: row.tool_count,
      idle_min: Math.round((now - row.last_seen_ts) / 60000),
    })
  }

  try {
    db.setDaemonMeta('last_stale_scan_ts', String(now))
  } catch (err) {
    log('warn', 'stale_meta_persist_failed', { error: err.message })
  }
}

module.exports = {
  detectStaleSessions,
  syncActiveSessionsToDb,
  STALE_TTL_MS,
}
