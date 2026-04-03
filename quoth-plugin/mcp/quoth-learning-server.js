// Quoth/quoth-plugin/mcp/quoth-learning-server.js
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')
const { spawnSync } = require('child_process')
const { promotePattern } = require(path.join(__dirname, '../daemon/lib/promote.js'))
const { extractSkill } = require(path.join(__dirname, '../daemon/lib/skill-extract.js'))

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
    description: 'Get top-N patterns by confidence score, optionally filtered by tags and reranked by Jina',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 5 },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        query: { type: 'string', description: 'Optional semantic query — triggers Jina reranking if JINA_API_KEY is set' }
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
  },
  {
    name: 'quoth_propose_update',
    description: 'Manually promote a high-confidence local pattern to the Quoth cloud index without waiting for the nightly cycle',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string', description: 'Local pattern ID to promote' }
      },
      required: ['patternId']
    }
  },
  {
    name: 'quoth_extract_skill',
    description: 'Extract a reusable test skill from a passing test file using Sonnet 4.6',
    inputSchema: {
      type: 'object',
      properties: {
        testFile: { type: 'string', description: 'Path to the passing test file' },
        feature: { type: 'string', description: 'Feature name for context' }
      },
      required: ['testFile']
    }
  },
  {
    name: 'quoth_list_skills',
    description: 'List all extracted skills from the local pattern database',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
      }
    }
  },
  {
    name: 'quoth_ingest_trajectory',
    description: 'Ingest trajectory entries from any source (OpenClaw, external agents, batch import). Writes to local trajectory store and signals daemon for processing.',
    inputSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              event: { type: 'string', default: 'tool_use' },
              agent: { type: 'string', description: 'Agent name (e.g. "morfeo", "hermes", "claude-code")' },
              project: { type: 'string', description: 'Project namespace' },
              task: { type: 'string', description: 'What the agent was doing' },
              outcome: { type: 'string', enum: ['success', 'failure'], description: 'Task outcome' },
              pattern_used: { type: 'string', description: 'Pattern that was applied (if any)' },
              source: { type: 'string', default: 'api', description: 'Source: claude-code, openclaw-telegram, openclaw-whatsapp, api' }
            },
            required: ['agent', 'task', 'outcome']
          },
          description: 'Array of trajectory entries to ingest'
        }
      },
      required: ['entries']
    }
  },
  {
    name: 'quoth_project_patterns',
    description: 'Get patterns relevant to a specific project (project-scoped + global patterns). Use at session start to inject learned patterns into context.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project namespace (e.g. "quoth", "exolar", "culturapp")' },
        limit: { type: 'number', default: 10, description: 'Max patterns to return' }
      },
      required: ['project']
    }
  },
  {
    name: 'quoth_promote_global',
    description: 'Manually promote a project-local pattern to global scope so all projects can benefit from it',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string', description: 'Pattern ID to promote' }
      },
      required: ['patternId']
    }
  },
  {
    name: 'quoth_agent_register',
    description: 'Register or update an agent in the Quoth coordination layer. Call at session start.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Unique agent identifier (e.g. "claude-code-montino-12345")' },
        name: { type: 'string', description: 'Human-readable name' },
        type: { type: 'string', enum: ['claude-code', 'openclaw', 'daemon', 'worker'], description: 'Agent type' },
        project: { type: 'string', description: 'Current project namespace' },
        platform: { type: 'string', description: 'Host platform (montino, aws, local)' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
        metadata: { type: 'object', description: 'Additional metadata' }
      },
      required: ['agentId', 'name', 'type']
    }
  },
  {
    name: 'quoth_agent_heartbeat',
    description: 'Send heartbeat to keep agent status as online. Call periodically.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        status: { type: 'string', enum: ['online', 'busy', 'idle'], description: 'Optional status update' }
      },
      required: ['agentId']
    }
  },
  {
    name: 'quoth_agent_list',
    description: 'List registered agents, optionally filtered by project, type, or status',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string', enum: ['online', 'offline', 'busy', 'idle'] },
        limit: { type: 'number', default: 20 }
      }
    }
  },
  {
    name: 'quoth_assign_task',
    description: 'Assign a task to an agent via the event system. The target agent can poll for assigned tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Target agent ID' },
        task: { type: 'string', description: 'Task description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        metadata: { type: 'object', description: 'Additional task context' }
      },
      required: ['agentId', 'task']
    }
  },
  {
    name: 'quoth_search_patterns',
    description: 'Search local patterns by semantic similarity to a query. Use this to find patterns related to specific features, error types, or techniques.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query — e.g. "login redirect wait patterns" or "table row count assertions"' },
        limit: { type: 'number', default: 5, description: 'Max results to return' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter' },
        includeSkills: { type: 'boolean', default: true, description: 'Include skill-type patterns in results' }
      },
      required: ['query']
    }
  }
]

async function handleTool(name, args) {
  const db = getDb()
  switch (name) {
    case 'quoth_log_outcome': {
      if (db.applyBayesianUpdate) {
        db.applyBayesianUpdate(args.patternId, args.result)
      } else {
        const delta = args.result === 'success' ? 0.03 : -0.03
        db.applyConfidenceDelta(args.patternId, delta)
      }
      const p = db.getPattern(args.patternId)
      return { logged: true, patternId: args.patternId, result: args.result, confidence: p?.confidence }
    }
    case 'quoth_score_pattern': {
      db.applyConfidenceDelta(args.patternId, args.delta)
      const p = db.getPattern(args.patternId)
      return { updated: true, pattern: p }
    }
    case 'quoth_top_patterns': {
      let patterns
      if (args.query) {
        // Try semantic search first (uses local embeddings)
        try {
          const { generateEmbedding } = require(path.join(__dirname, '../daemon/lib/embed.js'))
          const queryVec = await generateEmbedding(args.query)
          if (queryVec) {
            patterns = db.searchBySimilarity(queryVec, args.limit || 5, args.tags || [])
          }
        } catch {}
      }
      if (!patterns) {
        patterns = db.getTopPatterns(args.limit || 5, args.tags || [])
      }
      // Jina reranking as final pass if available
      if (args.query && process.env.JINA_API_KEY && patterns.length > 0) {
        try {
          const { rerankPatterns } = require(path.join(__dirname, '../daemon/lib/rerank.js'))
          patterns = await rerankPatterns(args.query, patterns)
        } catch {}
      }
      return { patterns }
    }
    case 'quoth_seed_from_exolar': {
      // Spawn a headless claude subprocess that queries Exolar and seeds patterns
      const sessionId = `exolar-seed-${Date.now()}`
      const trajFile = path.join(TRAJECTORIES_DIR, `${sessionId}.jsonl`)
      const prompt = `Query Exolar for clustered failures (dataset: clustered_failures${args.projectId ? `, project: ${args.projectId}` : ''}).
For each cluster, write a JSON line to: ${trajFile}
Format: {"event":"exolar_seed","session":"${sessionId}","task":"<cluster description>","outcome":"failure","pattern_used":"<error type>","agent":"exolar-importer","source":"exolar-seeded"}
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
    case 'quoth_extract_skill': {
      const skill = await extractSkill({
        testFile: args.testFile,
        feature: args.feature || path.basename(args.testFile, '.spec.ts')
      })
      if (!skill) return { error: 'Skill extraction failed — check test file exists and is readable' }
      const id = require('crypto').createHash('sha1').update(skill.name).digest('hex').slice(0, 12)
      db.upsertPattern({
        id: `skill-${id}`,
        name: skill.name,
        pattern_type: 'skill',
        condition: skill.description,
        action: skill.template,
        confidence: 0.85,
        tags: [...(skill.assertions || []), ...(skill.pageObjects || [])],
        source: 'skill-derived'
      })
      return { extracted: true, skill }
    }

    case 'quoth_list_skills': {
      const patterns = db.getTopPatterns(50, args.tags || [])
      const skills = patterns.filter(p => p.source === 'skill-derived' || p.pattern_type === 'skill')
      return { skills }
    }

    case 'quoth_ingest_trajectory': {
      const entries = args.entries || []
      if (entries.length === 0) return { ingested: 0 }

      const date = new Date().toISOString().slice(0, 10)
      const source = entries[0]?.source || 'api'
      const trajFile = path.join(TRAJECTORIES_DIR, `${source}-${date}.jsonl`)

      // Ensure directory exists
      fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true })

      // Write all entries
      const lines = entries.map(e => JSON.stringify({
        event: e.event || 'tool_use',
        agent: e.agent,
        project: e.project || 'unknown',
        session: e.session || `ingest-${Date.now()}`,
        task: e.task,
        outcome: e.outcome,
        pattern_used: e.pattern_used || null,
        source: e.source || 'api',
        timestamp: Date.now()
      })).join('\n') + '\n'

      fs.appendFileSync(trajFile, lines)

      // Signal daemon to process new entries
      let daemonSignaled = false
      const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
      if (fs.existsSync(pidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
          process.kill(pid, 'SIGUSR1')
          daemonSignaled = true
        } catch {}
      }

      return { ingested: entries.length, trajectoryFile: trajFile, daemonSignaled }
    }
    case 'quoth_search_patterns': {
      const limit = args.limit || 5
      let results = []

      // Try semantic search with local embeddings
      try {
        const { generateEmbedding } = require(path.join(__dirname, '../daemon/lib/embed.js'))
        const queryVec = await generateEmbedding(args.query)
        if (queryVec) {
          results = db.searchBySimilarity(queryVec, limit, args.tags || [])
        }
      } catch {}

      // Fallback: text-match using getTopPatterns with tag filtering
      if (results.length === 0) {
        results = db.getTopPatterns(limit * 2, args.tags || [])
        // Simple text relevance: filter patterns whose action/condition/name contain query words
        const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        if (queryWords.length > 0) {
          results = results.filter(p => {
            const text = `${p.name} ${p.condition} ${p.action}`.toLowerCase()
            return queryWords.some(w => text.includes(w))
          }).slice(0, limit)
        }
      }

      // Jina reranking as final pass
      if (process.env.JINA_API_KEY && results.length > 1) {
        try {
          const { rerankPatterns } = require(path.join(__dirname, '../daemon/lib/rerank.js'))
          results = await rerankPatterns(args.query, results)
        } catch {}
      }

      // Filter out skills if not wanted
      if (args.includeSkills === false) {
        results = results.filter(p => p.pattern_type !== 'skill' && p.source !== 'skill-derived')
      }

      return {
        query: args.query,
        count: results.length,
        patterns: results.slice(0, limit)
      }
    }

    case 'quoth_project_patterns': {
      const patterns = db.getProjectPatterns(args.project, args.limit || 10)
      return {
        project: args.project,
        count: patterns.length,
        patterns: patterns.map(p => ({
          id: p.id,
          name: p.name,
          condition: p.condition,
          action: p.action,
          confidence: p.confidence,
          namespace: p.namespace || 'default',
          tags: p.tags,
          source: p.source
        }))
      }
    }

    case 'quoth_promote_global': {
      const pattern = db.getPattern(args.patternId)
      if (!pattern) return { error: `Pattern '${args.patternId}' not found` }
      if (pattern.confidence < 0.6) {
        return { error: `Pattern confidence ${pattern.confidence.toFixed(2)} too low (min 0.6 for global promotion)` }
      }
      if (pattern.namespace === 'global') {
        return { alreadyGlobal: true, patternId: args.patternId }
      }
      db.promoteToGlobal(args.patternId)
      return { promoted: true, patternId: args.patternId, previousNamespace: pattern.namespace || 'default' }
    }

    case 'quoth_agent_register': {
      db.registerAgent({
        agentId: args.agentId,
        name: args.name,
        type: args.type,
        project: args.project,
        platform: args.platform,
        capabilities: args.capabilities,
        metadata: args.metadata
      })
      db.emitEvent('agent.registered', args.agentId, args.project, {
        name: args.name,
        type: args.type,
        platform: args.platform
      })
      return { registered: true, agentId: args.agentId }
    }

    case 'quoth_agent_heartbeat': {
      db.heartbeat(args.agentId, args.status)
      return { ok: true, agentId: args.agentId, timestamp: Date.now() }
    }

    case 'quoth_agent_list': {
      const agents = db.listAgents({
        project: args.project,
        type: args.type,
        status: args.status,
        limit: args.limit || 20
      })
      return { count: agents.length, agents }
    }

    case 'quoth_assign_task': {
      // Verify agent exists
      const targetAgent = db.listAgents({ limit: 100 }).find(a => a.agent_id === args.agentId)

      const assignResult = db.emitEvent('task.assigned', args.agentId, targetAgent?.project, {
        task: args.task,
        priority: args.priority || 'medium',
        assignedBy: 'mcp',
        ...(args.metadata || {})
      })

      return {
        assigned: true,
        eventId: assignResult.lastInsertRowid,
        agentId: args.agentId,
        task: args.task
      }
    }

    case 'quoth_propose_update': {
      const pattern = db.getPattern(args.patternId)
      if (!pattern) return { error: `Pattern '${args.patternId}' not found in local DB` }
      const result = await promotePattern(pattern)
      if (!result) return { error: 'Promotion failed — check QUOTH_API_KEY and daemon logs' }
      db.markPromoted(pattern.id, result.documentId, pattern.confidence)
      return { promoted: true, documentId: result.documentId, version: result.version, status: result.status }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
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
      const result = await handleTool(msg.params.name, msg.params.arguments || {})
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
