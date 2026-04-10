#!/usr/bin/env node
/**
 * One-time migration: re-embed all active patterns with the Extract Pipeline v2
 * embedding text format.
 *
 * Before v2: embedding text was a loose concatenation (name + action + condition).
 * After  v2: embedding text is `${condition} → ${action}` (matches what extract.js
 * uses for dedup lookups).
 *
 * Running this script re-computes every active pattern's embedding using the new
 * format so cosine-similarity dedup between newly-extracted patterns and pre-v2
 * patterns stays consistent.
 *
 * Idempotent: computing the same embedding twice yields the same vector.
 * Safe: per-pattern update is wrapped in try/catch; one bad row cannot abort the run.
 * Exit code: 0 on success, 1 if any errors occurred.
 *
 * Usage:
 *   node quoth-plugin/scripts/reembed-patterns.js
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// Load .env (so MiniLM caching paths, etc. behave the same as daemon)
const projectRoot = path.join(__dirname, '..', '..')
for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(projectRoot, envFile)
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const stripped = line.replace(/\s+#.*$/, '')
      const m = stripped.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {}
}

const { createDb } = require('../daemon/db.js')
const { generateEmbeddingBatch } = require('../daemon/lib/embed.js')

const DB_PATH =
  process.env.QUOTH_DB_PATH ||
  path.join(process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), 'memory.db')

const BATCH_SIZE = 50

function buildEmbeddingText(condition, action) {
  const c = (condition || '').trim()
  const a = (action || '').trim()
  if (!c || !a) return null
  return `${c} → ${a}`
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`[reembed] No database found at ${DB_PATH} — nothing to do.`)
    process.exit(0)
  }

  const db = createDb(DB_PATH)

  const patterns = db
    .prepare(
      `SELECT id, condition, action FROM patterns WHERE status = 'active' ORDER BY created_at ASC`
    )
    .all()

  if (patterns.length === 0) {
    console.log('[reembed] No active patterns in database — nothing to do.')
    process.exit(0)
  }

  console.log(`[reembed] Re-embedding ${patterns.length} active patterns (batch=${BATCH_SIZE})...`)

  const updateStmt = db.prepare('UPDATE patterns SET embedding = ? WHERE id = ?')

  const start = Date.now()
  let reembedded = 0
  let skipped = 0
  let errors = 0
  let processed = 0

  for (let i = 0; i < patterns.length; i += BATCH_SIZE) {
    const chunk = patterns.slice(i, i + BATCH_SIZE)

    const textsToEmbed = []
    const indicesToEmbed = [] // maps textsToEmbed idx -> chunk idx

    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j]
      const text = buildEmbeddingText(p.condition, p.action)
      if (!text) {
        console.warn(
          `[reembed] skip ${p.id}: missing condition or action (legacy pre-v2 row)`
        )
        skipped++
        continue
      }
      textsToEmbed.push(text)
      indicesToEmbed.push(j)
    }

    let vectors = []
    if (textsToEmbed.length > 0) {
      try {
        vectors = await generateEmbeddingBatch(textsToEmbed)
      } catch (err) {
        console.error(`[reembed] batch embedding failed: ${err && err.message}`)
        errors += textsToEmbed.length
        processed += chunk.length
        continue
      }
    }

    for (let k = 0; k < indicesToEmbed.length; k++) {
      const p = chunk[indicesToEmbed[k]]
      const vec = vectors[k]
      if (!vec || !Array.isArray(vec) || vec.length === 0) {
        console.warn(`[reembed] ${p.id}: null embedding result`)
        errors++
        continue
      }
      try {
        updateStmt.run(JSON.stringify(vec), p.id)
        reembedded++
      } catch (err) {
        console.error(`[reembed] ${p.id}: update failed — ${err && err.message}`)
        errors++
      }
    }

    processed += chunk.length
    if (processed % 50 === 0 || processed === patterns.length) {
      const rate = processed / Math.max(1, (Date.now() - start) / 1000)
      process.stdout.write(
        `  ${processed}/${patterns.length}  (${rate.toFixed(1)}/s, ${reembedded} ok, ${skipped} skip, ${errors} err)\r`
      )
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000)
  console.log(
    `\n[reembed] Done: ${patterns.length} total, ${reembedded} re-embedded, ${skipped} skipped, ${errors} errors, ${elapsed}s elapsed`
  )

  process.exit(errors > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[reembed] Fatal:', err && err.stack ? err.stack : err)
  process.exit(1)
})
