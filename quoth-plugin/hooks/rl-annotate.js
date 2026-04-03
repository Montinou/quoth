#!/usr/bin/env node
'use strict'

// PostToolUse RL hook: annotates tool outputs with pattern relevance signals
// Reads tool_name + tool_input from stdin, queries pattern DB for matches,
// returns additionalContext with confidence scores

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const DB_MODULE = process.env.QUOTH_DB_MODULE || path.join(__dirname, '..', 'daemon', 'db.js')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  try {
    if (!fs.existsSync(DB_PATH) || !fs.existsSync(DB_MODULE)) {
      process.stdout.write('{}')
      return
    }

    const hookData = JSON.parse(input)
    const toolName = hookData.tool_name || ''
    const toolInput = hookData.tool_input || {}

    // Build search context from tool usage
    const searchContext = `${toolName} ${toolInput.command || toolInput.file_path || toolInput.pattern || toolInput.query || ''}`.trim()
    if (searchContext.length < 5) {
      process.stdout.write('{}')
      return
    }

    const { createDb } = require(DB_MODULE)
    const db = createDb(DB_PATH)

    // Find relevant patterns by tag matching (fast, no embedding needed)
    const toolTag = toolName.toLowerCase()
    const patterns = db.getTopPatterns(3, [toolTag])
    db.close()

    if (patterns.length === 0) {
      process.stdout.write('{}')
      return
    }

    // Format as RL signal
    const signals = patterns.map(p =>
      `[${p.confidence.toFixed(2)}] ${p.name}: ${p.action.slice(0, 100)}`
    ).join('\n')

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[Quoth RL] Relevant patterns for ${toolName}:\n${signals}`
      }
    }))
  } catch {
    process.stdout.write('{}')
  }
})
