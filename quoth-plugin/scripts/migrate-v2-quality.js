#!/usr/bin/env node
/**
 * V2 quality-gate bulk migration.
 *
 * One-shot operation that:
 *   1. Backs up the current DB
 *   2. Computes distinctiveness scores for all active patterns
 *   3. Archives patterns failing the generic-name regex
 *   4. Reports counts by retirement reason
 *
 * Safe to dry-run against a copy. To run against prod:
 *   node quoth-plugin/scripts/migrate-v2-quality.js
 * Or against a copy:
 *   QUOTH_DB_PATH=/tmp/quoth-test.db node quoth-plugin/scripts/migrate-v2-quality.js
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { createDb } = require('../daemon/db.js')
const { backfillDistinctiveness, isGenericName } = require('../daemon/lib/curation.js')

const dbPath = process.env.QUOTH_DB_PATH || path.join(os.homedir(), '.quoth', 'memory.db')
console.log(`Migrating: ${dbPath}`)

// Backup unless explicitly skipped
if (!process.env.QUOTH_SKIP_BACKUP) {
  const backupPath = `${dbPath}.pre-v2-${Date.now()}.bak`
  fs.copyFileSync(dbPath, backupPath)
  console.log(`Backup: ${backupPath}`)
}

const db = createDb(dbPath)

// 1. Distinctiveness
console.log('Computing distinctiveness...')
const n = backfillDistinctiveness(db)
console.log(`  ✓ ${n} patterns scored`)

// 2. Flag generic names
console.log('Archiving generic-name patterns...')
const patterns = db.prepare("SELECT id, name FROM patterns WHERE status='active'").all()
let flagged = 0
const now = Date.now()
const tx = db.transaction(() => {
  for (const p of patterns) {
    if (isGenericName(p.name)) {
      db.prepare("UPDATE patterns SET status='archived', retired_at=?, retired_reason='generic-name' WHERE id=?")
        .run(now, p.id)
      flagged++
    }
  }
})
tx()
console.log(`  ✓ ${flagged} archived`)

// 3. Summary
const stats = db.prepare(`
  SELECT status, COUNT(*) n FROM patterns GROUP BY status
`).all()
console.log('\nFinal pattern counts by status:')
for (const r of stats) console.log(`  ${r.status}: ${r.n}`)

const byReason = db.prepare(`
  SELECT retired_reason, COUNT(*) n FROM patterns
  WHERE retired_at IS NOT NULL GROUP BY retired_reason
`).all()
if (byReason.length > 0) {
  console.log('\nRetirement reasons:')
  for (const r of byReason) console.log(`  ${r.retired_reason || '(null)'}: ${r.n}`)
}

console.log('\nDone.')
