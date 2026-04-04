// Quoth/quoth-plugin/mcp/quoth-learning-server.js
'use strict'

const path = require('path')
const os = require('os')
const readline = require('readline')

const { ALL_TOOLS, dispatch } = require('./handlers')

const JSONRPC_VERSION = '2.0'
const MCP_PROTOCOL_VERSION = '2024-11-05'
const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')

// Lazy-load db (only if needed, avoids startup failure if better-sqlite3 not installed)
let _db = null
function getDb() {
  if (_db) return _db
  const { createDb } = require(path.join(__dirname, '../daemon/db.js'))
  _db = createDb(DB_PATH)
  return _db
}

// --- MCP stdio protocol ---
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n') }

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }

  if (msg.method === 'initialize') {
    send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'quoth-learning', version: '2.0.0' }
    }})
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: JSONRPC_VERSION, id: msg.id, result: { tools: ALL_TOOLS } })
  } else if (msg.method === 'tools/call') {
    if (!msg.params || !msg.params.name) {
      send({ jsonrpc: JSONRPC_VERSION, id: msg.id, error: { code: -32602, message: 'Invalid params' } })
      return
    }
    try {
      const result = await dispatch(msg.params.name, msg.params.arguments || {}, getDb())
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
