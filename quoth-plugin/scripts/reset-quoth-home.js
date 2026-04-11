'use strict'

/**
 * Greenfield reset for ~/.quoth (spec §6.6 cutover step 3).
 *
 * Used by Task 25's `cli.js reset` subcommand and the Task 27 cutover
 * sandbox test. Tars the caller-supplied QUOTH_HOME to a sibling
 * `.quoth-backup-<ISO>.tar.gz` file, then deletes the canonical wipe set:
 *   - memory.db
 *   - hnsw.bin
 *   - intelligence/
 *   - trajectories/processing-deferred/
 *
 * Everything else in QUOTH_HOME (`.env`, credentials, active/done/routine
 * trajectory buckets) is preserved. The wipe is explicit and narrow — we
 * do NOT `rm -rf` the home, so a user who runs the reset after hours of
 * agent sessions does not lose the trajectory archive.
 *
 * The function is synchronous and throws on failure. The backup tarball
 * is always created first; if tar fails we refuse to wipe.
 *
 * Exports: `resetQuothHome({ home, confirm, log? }) → { wiped, backupPath? }`.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const WIPE_PATHS = [
  'memory.db',
  'hnsw.bin',
  'intelligence',
  path.join('trajectories', 'processing-deferred'),
]

function isoStamp() {
  // 2026-04-11T16-42-07 — safe for filenames on all platforms.
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
}

function resetQuothHome({ home, confirm = false, log = () => {} } = {}) {
  if (!home) throw new Error('resetQuothHome: home is required')
  if (!fs.existsSync(home)) throw new Error(`resetQuothHome: home does not exist: ${home}`)
  if (!confirm) {
    log('reset skipped: confirm !== true')
    return { wiped: false }
  }

  const parent = path.dirname(home)
  const base = path.basename(home)
  const backupPath = path.join(parent, `${base}-backup-${isoStamp()}.tar.gz`)

  // Tar the entire home from its parent so paths inside the archive are
  // relative to the home directory name (makes inspection + restore easy).
  try {
    execSync(`tar -czf "${backupPath}" -C "${parent}" "${base}"`, { stdio: 'pipe' })
  } catch (err) {
    throw new Error(`backup failed: ${err.message}`)
  }
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`backup is empty or missing: ${backupPath}`)
  }
  log(`backup: ${backupPath}`)

  for (const rel of WIPE_PATHS) {
    const abs = path.join(home, rel)
    if (!fs.existsSync(abs)) continue
    try {
      fs.rmSync(abs, { recursive: true, force: true })
      log(`wiped: ${rel}`)
    } catch (err) {
      throw new Error(`failed to wipe ${rel}: ${err.message}`)
    }
  }

  return { wiped: true, backupPath }
}

module.exports = { resetQuothHome, WIPE_PATHS }
