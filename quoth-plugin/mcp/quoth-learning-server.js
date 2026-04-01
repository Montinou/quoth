// Quoth/quoth-plugin/mcp/quoth-learning-server.js
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')
const { spawnSync } = require('child_process')

const JSONRPC_VERSION = '2.0'
const MCP_PROTOCOL_VERSION = '2024-11-05'
const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')

// Lazy-load db (only if needed, avoids startup failure if better-sqlite3 not installed)
let _db = null
function getDb() {
  if (_db) return _db
  const { createDb } = require(path.join(__dirname, '../daemon/db.js'))
  _db = createDb(DB_PATH)
  return _db
}

const TOOLS = [
  {
    name: 'quoth_log_outcome',
    description: 'Record the outcome of using a pattern (success/failure). Feeds confidence scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string', description: 'Pattern ID that was used' },
        result: { type: 'string', enum: ['success', 'failure'], description: 'Outcome' },
        context: { type: 'string', description: 'Optional context about the use' }
      },
      required: ['patternId', 'result']
    }
  },
  {
    name: 'quoth_score_pattern',
    description: 'Manually adjust a pattern confidence score',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        delta: { type: 'number', description: 'Confidence delta (+0.03 for success, -0.03 for failure)' }
      },
      required: ['patternId', 'delta']
    }
  },
  {
    name: 'quoth_top_patterns',
    description: 'Get top-N patterns by confidence score, optionally filtered by tags',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 5 },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
      }
    }
  },
  {
    name: 'quoth_seed_from_exolar',
    description: 'Import Exolar clustered failures as pattern candidates',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', default: 'clustered_failures' },
        projectId: { type: 'string' }
      }
    }
  },
  {
    name: 'quoth_daemon_status',
    description: 'Check if the Quoth learning daemon is running',
    inputSchema: { type: 'object', properties: {} }
  }
]

function handleTool(name, args) {
  const db = getDb()
  switch (name) {
    case 'quoth_log_outcome': {
      const delta = args.result === 'success' ? 0.03 : -0.03
      db.applyConfidenceDelta(args.patternId, delta)
      return { logged: true, patternId: args.patternId, delta }
    }
    case 'quoth_score_pattern': {
      db.applyConfidenceDelta(args.patternId, args.delta)
      const p = db.getPattern(args.patternId)
      return { updated: true, pattern: p }
    }
    case 'quoth_top_patterns': {
      const patterns = db.getTopPatterns(args.limit || 5, args.tags || [])
      return { patterns }
    }
    case 'quoth_seed_from_exolar': {
      // Spawn a headless claude subprocess that queries Exolar and seeds patterns
      const sessionId = `exolar-seed-${Date.now()}`
      const trajFile = path.join(TRAJECTORIES_DIR, `${sessionId}.jsonl`)
      const prompt = `Query Exolar for clustered failures (dataset: clustered_failures${args.projectId ? `, project: ${args.projectId}` : ''}).
For each cluster, write a JSON line to: ${trajFile}
Format: {"event":"exolar_seed","session":"${sessionId}","task":"<cluster description>","outcome":"failure","pattern_used":"<error type>","agent":"exolar-importer"}
One line per cluster. Use the mcp__plugin_triqual-plugin_exolar-qa__query_exolar_data tool.`
      try {
        fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true })
        spawnSync('claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
          input: prompt,
          encoding: 'utf8',
          timeout: 60000,
          stdio: ['pipe', 'pipe', 'ignore']
        })
        return { seeded: true, trajectoryFile: trajFile }
      } catch (err) {
        return { seeded: false, error: err.message }
      }
    }
    case 'quoth_daemon_status': {
      const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
      if (!fs.existsSync(pidFile)) return { running: false }
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
      try {
        process.kill(pid, 0) // signal 0 = check existence
        const logFile = path.join(QUOTH_HOME, 'daemon.log')
        const lastLog = fs.existsSync(logFile)
          ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-3).join('\n')
          : 'no log'
        return { running: true, pid, lastLog }
      } catch {
        return { running: false, stalePid: pid }
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// --- MCP stdio protocol ---
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }

  if (msg.method === 'initialize') {
    send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'quoth-learning', version: '1.0.0' }
    }})
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: { tools: TOOLS } })
  } else if (msg.method === 'tools/call') {
    if (!msg.params || !msg.params.name) {
      send({ jsonrpc: JSONRPC_VERSION, id: msg.id, error: { code: -32602, message: 'Invalid params' } })
      return
    }
    try {
      const result = handleTool(msg.params.name, msg.params.arguments || {})
      send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      }})
    } catch (err) {
      send({ jsonrpc: JSONRPC_VERSION, id: msg.id, error: { code: -32603, message: err.message } })
    }
  } else if (msg.id !== undefined) {
    send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: {} })
  }
})
