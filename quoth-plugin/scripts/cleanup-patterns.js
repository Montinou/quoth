#!/usr/bin/env node
/**
 * One-time cleanup: archive garbage patterns and deduplicate by name.
 * Safe to run multiple times — idempotent.
 *
 * Usage: node quoth-plugin/scripts/cleanup-patterns.js [--dry-run]
 */
'use strict'

const path = require('path')
const os = require('os')

const DB_PATH = path.join(os.homedir(), '.quoth', 'memory.db')
const { createDb } = require('../daemon/db.js')
const db = createDb(DB_PATH)

const dryRun = process.argv.includes('--dry-run')
const log = (msg) => console.log(`[cleanup] ${msg}`)

// Phase 1: Archive raw-tool-call patterns (fallback garbage)
const rawToolPatterns = [
  "name LIKE 'claude-code: Bash %'",
  "name LIKE 'claude-code: Write /%'",
  "name LIKE 'claude-code: Edit /%'",
  "name LIKE 'claude-code: Read /%'",
  "name LIKE 'claude-code: Glob %'",
  "name LIKE 'claude-code: Grep %'",
  "name LIKE 'claude-code: Agent %'",
]

const garbageCount = db.prepare(`
  SELECT COUNT(*) as c FROM patterns
  WHERE status = 'active' AND (${rawToolPatterns.join(' OR ')})
`).get().c

log(`Phase 1: Found ${garbageCount} raw-tool-call patterns`)

if (!dryRun && garbageCount > 0) {
  const result = db.prepare(`
    UPDATE patterns SET status = 'archived', updated_at = strftime('%s','now') * 1000
    WHERE status = 'active' AND (${rawToolPatterns.join(' OR ')})
  `).run()
  log(`  Archived ${result.changes} garbage patterns`)
}

// Phase 2: Deduplicate by normalized name prefix
const remaining = db.prepare(`
  SELECT id, name, confidence, alpha, beta FROM patterns
  WHERE status = 'active' ORDER BY confidence DESC
`).all()

const seen = new Map()
let dedupCount = 0
const toArchive = []

for (const p of remaining) {
  const norm = (p.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 50)
  if (norm.length < 10) continue
  if (seen.has(norm)) {
    toArchive.push(p.id)
    dedupCount++
  } else {
    seen.set(norm, p.id)
  }
}

log(`Phase 2: Found ${dedupCount} name-duplicate patterns`)

if (!dryRun && toArchive.length > 0) {
  const archiveStmt = db.prepare("UPDATE patterns SET status='archived', updated_at=strftime('%s','now')*1000 WHERE id=?")
  const strengthenStmt = db.prepare("UPDATE patterns SET alpha=alpha+1, confidence=(alpha+1.0)/(alpha+1.0+beta), updated_at=strftime('%s','now')*1000 WHERE id=?")
  const tx = db.transaction(() => {
    for (const id of toArchive) {
      archiveStmt.run(id)
    }
    // Strengthen the survivors
    for (const [, id] of seen) {
      strengthenStmt.run(id)
    }
  })
  tx()
  log(`  Archived ${toArchive.length} duplicates, strengthened ${seen.size} survivors`)
}

// Summary
const after = db.prepare(`
  SELECT COUNT(*) as total,
    AVG(confidence) as avg_conf,
    MIN(confidence) as min_conf,
    MAX(confidence) as max_conf
  FROM patterns WHERE status = 'active'
`).get()

const archived = db.prepare("SELECT COUNT(*) as c FROM patterns WHERE status = 'archived'").get().c

log(`\nResults${dryRun ? ' (DRY RUN)' : ''}:`)
log(`  Active patterns: ${after.total}`)
log(`  Archived total: ${archived}`)
log(`  Avg confidence: ${(after.avg_conf || 0).toFixed(3)}`)
log(`  Range: ${(after.min_conf || 0).toFixed(3)} — ${(after.max_conf || 0).toFixed(3)}`)
