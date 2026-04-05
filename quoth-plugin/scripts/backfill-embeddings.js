#!/usr/bin/env node
/**
 * Backfill voyage-4-lite embeddings for active patterns missing them.
 * Idempotent: only processes patterns where embedding IS NULL.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

// Load .env like daemon does
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

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('ERROR: AI_GATEWAY_API_KEY not set')
  process.exit(1)
}

const { createDb } = require('../daemon/db.js')
const { generateEmbedding } = require('../daemon/lib/embed.js')

const dbPath = path.join(os.homedir(), '.quoth', 'memory.db')
const db = createDb(dbPath)

const MAX = parseInt(process.env.MAX || '1000', 10)
const patterns = db.prepare(`
  SELECT id, name, action, condition FROM patterns
  WHERE status='active' AND embedding IS NULL
  ORDER BY created_at DESC LIMIT ?
`).all(MAX)

console.log(`Backfilling embeddings for ${patterns.length} patterns...`)

const updateStmt = db.prepare('UPDATE patterns SET embedding = ? WHERE id = ?')
let done = 0, failed = 0, start = Date.now()

async function run() {
  for (const p of patterns) {
    const text = `${p.name || ''} ${p.action || ''} ${p.condition || ''}`.trim()
    if (!text) { failed++; continue }
    try {
      const embed = await generateEmbedding(text)
      if (embed && Array.isArray(embed) && embed.length > 0) {
        updateStmt.run(JSON.stringify(embed), p.id)
        done++
      } else {
        failed++
      }
    } catch (e) {
      failed++
    }
    if ((done + failed) % 50 === 0) {
      const rate = (done + failed) / ((Date.now() - start) / 1000)
      process.stdout.write(`  ${done + failed}/${patterns.length}  (${rate.toFixed(1)}/s, ${done} ok, ${failed} fail)\r`)
    }
  }
  const elapsed = Math.round((Date.now() - start) / 1000)
  console.log(`\nDone: ${done} embedded, ${failed} failed, ${elapsed}s elapsed`)
}

run().catch(e => { console.error(e); process.exit(1) })
