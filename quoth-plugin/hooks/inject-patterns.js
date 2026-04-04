#!/usr/bin/env node
'use strict'

// SessionStart hook: injects relevant patterns into Claude Code context
// Reads project from CLAUDE_PROJECT_DIR, queries local pattern DB,
// outputs patterns as hook message for agent context enrichment

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const REAL_DIR = fs.realpathSync(__dirname)
const DB_MODULE = process.env.QUOTH_DB_MODULE || path.join(REAL_DIR, '..', 'daemon', 'db.js')

try {
  // Determine project namespace
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const project = path.basename(projectDir)

  // Check if DB exists
  if (!fs.existsSync(DB_PATH)) {
    process.stdout.write('{}')
    process.exit(0)
  }

  // Direct SQLite access (faster than MCP roundtrip for session start)
  const { createDb } = require(DB_MODULE)
  const db = createDb(DB_PATH)

  // Get project-scoped + global patterns
  const patterns = db.getProjectPatterns(project, 8)
  db.close()

  if (patterns.length === 0) {
    process.stdout.write('{}')
    process.exit(0)
  }

  // Token-efficient format: ~30 tokens per pattern vs ~80 in verbose format
  const MAX_INJECT_CHARS = 800 // ~200 tokens at 4 chars/token

  function compressPatterns(pats) {
    if (pats.length === 0) return ''

    const high = pats.filter(p => p.confidence >= 0.8)
    const medium = pats.filter(p => p.confidence >= 0.5 && p.confidence < 0.8)

    let output = `[Quoth] ${pats.length} patterns loaded\n`

    if (high.length > 0) {
      output += 'HIGH: ' + high.map(p =>
        `${p.name}(${p.confidence.toFixed(1)})`
      ).join(', ') + '\n'
    }

    if (medium.length > 0) {
      output += 'MED: ' + medium.map(p =>
        `${p.name}(${p.confidence.toFixed(1)})`
      ).join(', ') + '\n'
    }

    // Only include action text for top 3 patterns
    const top3 = pats.slice(0, 3)
    if (top3.length > 0) {
      output += 'Details:\n' + top3.map(p =>
        `- ${p.name}: ${p.action.slice(0, 120)}`
      ).join('\n')
    }

    // Truncate if over budget
    if (output.length > MAX_INJECT_CHARS) {
      output = output.slice(0, MAX_INJECT_CHARS) + '...'
    }

    return output
  }

  const compressed = compressPatterns(patterns)

  // Output as hook response with message
  process.stdout.write(JSON.stringify({
    message: {
      role: 'system',
      content: compressed
    }
  }))
} catch (err) {
  // Never fail the hook — output empty on error
  process.stdout.write('{}')
}
