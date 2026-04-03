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
const DB_MODULE = process.env.QUOTH_DB_MODULE || '/home/lord_montino/projects/agents-tools/quoth/quoth-plugin/daemon/db.js'

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

  // Format patterns for injection into agent context
  const patternText = patterns.map(p =>
    `- [${p.confidence.toFixed(2)}] ${p.name}: ${p.action}`
  ).join('\n')

  const message = `[Quoth] ${patterns.length} patterns loaded for project "${project}":\n${patternText}`

  // Output as hook response with message
  process.stdout.write(JSON.stringify({
    message: {
      role: 'system',
      content: message
    }
  }))
} catch (err) {
  // Never fail the hook — output empty on error
  process.stdout.write('{}')
}
