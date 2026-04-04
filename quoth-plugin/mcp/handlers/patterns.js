'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')

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
    name: 'quoth_search_patterns',
    description: 'Search local patterns by semantic similarity to a query. Use this to find patterns related to specific features, error types, or techniques.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query' },
        limit: { type: 'number', default: 5 },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter' },
        includeSkills: { type: 'boolean', default: true, description: 'Include skill-type patterns' }
      },
      required: ['query']
    }
  },
  {
    name: 'quoth_project_patterns',
    description: 'Get patterns relevant to a specific project (project-scoped + global patterns).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project namespace' },
        limit: { type: 'number', default: 10 }
      },
      required: ['project']
    }
  },
  {
    name: 'quoth_promote_global',
    description: 'Manually promote a project-local pattern to global scope so all projects can benefit',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string', description: 'Pattern ID to promote' }
      },
      required: ['patternId']
    }
  }
]

async function handle(name, args, db) {
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
      // Use Bayesian update when delta direction is clear, fall back to direct delta for fine-grained adjustments
      if (args.delta > 0) {
        db.applyBayesianUpdate(args.patternId, 'success')
      } else if (args.delta < 0) {
        db.applyBayesianUpdate(args.patternId, 'failure')
      }
      const p = db.getPattern(args.patternId)
      return { updated: true, pattern: p }
    }
    case 'quoth_top_patterns': {
      let patterns
      if (args.query) {
        try {
          const { generateEmbedding } = require(path.join(__dirname, '../../daemon/lib/embed.js'))
          const queryVec = await generateEmbedding(args.query)
          if (queryVec) {
            patterns = db.searchBySimilarity(queryVec, args.limit || 5, args.tags || [])
          }
        } catch {}
      }
      if (!patterns) {
        patterns = db.getTopPatterns(args.limit || 5, args.tags || [])
      }
      if (args.query && process.env.JINA_API_KEY && patterns.length > 0) {
        try {
          const { rerankPatterns } = require(path.join(__dirname, '../../daemon/lib/rerank.js'))
          patterns = await rerankPatterns(args.query, patterns)
        } catch {}
      }
      return { patterns }
    }
    case 'quoth_seed_from_exolar': {
      const sessionId = `exolar-seed-${Date.now()}`
      const trajFile = path.join(TRAJECTORIES_DIR, `${sessionId}.jsonl`)
      const prompt = `Query Exolar for clustered failures (dataset: clustered_failures${args.projectId ? `, project: ${args.projectId}` : ''}).
For each cluster, write a JSON line to: ${trajFile}
Format: {"event":"exolar_seed","session":"${sessionId}","task":"<cluster description>","outcome":"failure","pattern_used":"<error type>","agent":"exolar-importer","source":"exolar-seeded"}
One line per cluster. Use the mcp__plugin_triqual-plugin_exolar-qa__query_exolar_data tool.`
      try {
        fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true })
        spawnSync('claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'], {
          input: prompt, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore']
        })
        return { seeded: true, trajectoryFile: trajFile }
      } catch (err) {
        return { seeded: false, error: err.message }
      }
    }
    case 'quoth_propose_update': {
      const { promotePattern } = require(path.join(__dirname, '../../daemon/lib/promote.js'))
      const pattern = db.getPattern(args.patternId)
      if (!pattern) return { error: `Pattern '${args.patternId}' not found in local DB` }
      const result = await promotePattern(pattern)
      if (!result) return { error: 'Promotion failed — check QUOTH_API_KEY and daemon logs' }
      db.markPromoted(pattern.id, result.documentId, pattern.confidence)
      return { promoted: true, documentId: result.documentId, version: result.version, status: result.status }
    }
    case 'quoth_search_patterns': {
      const limit = args.limit || 5
      let results = []
      try {
        const { generateEmbedding } = require(path.join(__dirname, '../../daemon/lib/embed.js'))
        const queryVec = await generateEmbedding(args.query)
        if (queryVec) results = db.searchBySimilarity(queryVec, limit, args.tags || [])
      } catch {}
      if (results.length === 0) {
        results = db.getTopPatterns(limit * 2, args.tags || [])
        const queryWords = args.query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        if (queryWords.length > 0) {
          results = results.filter(p => {
            const text = `${p.name} ${p.condition} ${p.action}`.toLowerCase()
            return queryWords.some(w => text.includes(w))
          }).slice(0, limit)
        }
      }
      if (process.env.JINA_API_KEY && results.length > 1) {
        try {
          const { rerankPatterns } = require(path.join(__dirname, '../../daemon/lib/rerank.js'))
          results = await rerankPatterns(args.query, results)
        } catch {}
      }
      if (args.includeSkills === false) {
        results = results.filter(p => p.pattern_type !== 'skill' && p.source !== 'skill-derived')
      }
      const finalResults = results.slice(0, limit)
      // Mark last_matched_at on returned patterns so decay/feedback can target them
      const now = Date.now()
      for (const p of finalResults) {
        if (p.id) {
          db.prepare('UPDATE patterns SET last_matched_at = ? WHERE id = ?').run(now, p.id)
        }
      }
      // Write matched IDs for feedback loop (intelligence.js applyFeedback reads this)
      try {
        const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')
        if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
        const matchedIds = finalResults.map(p => `pat-${p.id}`)
        fs.writeFileSync(path.join(STATE_DIR, 'last-matched.json'), JSON.stringify(matchedIds))
      } catch {}
      return { query: args.query, count: finalResults.length, patterns: finalResults }
    }
    case 'quoth_project_patterns': {
      const patterns = db.getProjectPatterns(args.project, args.limit || 10)
      return {
        project: args.project,
        count: patterns.length,
        patterns: patterns.map(p => ({
          id: p.id, name: p.name, condition: p.condition, action: p.action,
          confidence: p.confidence, namespace: p.namespace || 'default',
          tags: p.tags, source: p.source
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
    default:
      return null
  }
}

module.exports = { TOOLS, handle }
