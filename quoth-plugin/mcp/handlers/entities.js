'use strict'

// Task 20 / spec §6.3: MCP tool handler for the knowledge-entities redesign.
//
// Replaces the legacy `patterns.js` handler. Surfaces 11 tools over the
// shared `handle(name, args, db)` entrypoint:
//
//   quoth_top_entities         — SQLite read
//   quoth_search_entities      — GET /inject (prompt, kinds, limit)
//   quoth_score_entity         — Bayesian alpha/beta update on knowledge_entities
//   quoth_promote_entity       — scope: 'project:<x>' → 'global'
//   quoth_recall_decisions     — GET /inject with kinds=decision
//   quoth_recall_anti_patterns — GET /inject with kinds=anti_pattern
//   quoth_recall_global        — GET /inject with project=global
//   quoth_log_decision         — upsertEntity kind=decision, source=agent_logged
//   quoth_log_anti_pattern     — upsertEntity kind=anti_pattern, source=agent_logged
//   quoth_health               — GET /health
//   quoth_replay_session       — read error/ JSONL, report dry-run diff
//
// Injection-bound tools talk to the daemon over the unix socket at
// ~/.quoth/daemon.sock (same transport as hooks/hook-dispatch.js). They
// fail open to an empty-results response when the daemon is unreachable,
// so MCP never blocks.

const fs = require('fs')
const http = require('http')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const SOCK_PATH = path.join(QUOTH_HOME, 'daemon.sock')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')

function daemonSocketPath() {
  // Recompute each call so test QUOTH_HOME changes are honored.
  return path.join(process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), 'daemon.sock')
}

function fetchDaemon(urlPath, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: daemonSocketPath(),
      path: urlPath,
      method: 'GET',
      timeout: timeoutMs,
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body || '{}')) }
        catch { reject(new Error('Invalid JSON from daemon')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('daemon request timeout')); reject(new Error('daemon request timeout')) })
    req.end()
  })
}

function buildInjectUrl({ prompt, project, kinds, limit }) {
  const params = new URLSearchParams()
  if (prompt != null) params.set('prompt', String(prompt))
  if (project != null) params.set('project', String(project))
  if (kinds != null) params.set('kinds', Array.isArray(kinds) ? kinds.join(',') : String(kinds))
  if (limit != null) params.set('limit', String(limit))
  return `/inject?${params.toString()}`
}

function canonicalizeDecision({ situation, options = [], choice, reasoning }) {
  // Canonical content = what gets embedded. Include every material input so
  // near-duplicate decisions collapse to the same id.
  const opts = Array.isArray(options) ? options : []
  return [
    `situation: ${situation || ''}`,
    `options: ${opts.join(' | ')}`,
    `choice: ${choice || ''}`,
    `reasoning: ${reasoning || ''}`,
  ].join('\n')
}

function canonicalizeAntiPattern({ condition, what_not_to_do, why_failed }) {
  return [
    `condition: ${condition || ''}`,
    `avoid: ${what_not_to_do || ''}`,
    `because: ${why_failed || ''}`,
  ].join('\n')
}

const TOOLS = [
  {
    name: 'quoth_top_entities',
    description: 'Get top knowledge entities by confidence score, optionally filtered by kind (pattern|decision|anti_pattern|fact).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['pattern', 'decision', 'anti_pattern', 'fact'] },
        limit: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'quoth_search_entities',
    description: 'Semantic search over knowledge entities via the daemon /inject fast-path.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', default: 5 },
        project: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'quoth_score_entity',
    description: 'Apply a Bayesian confidence update to a knowledge entity (outcome: success|failure).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        outcome: { type: 'string', enum: ['success', 'failure'] },
      },
      required: ['id', 'outcome'],
    },
  },
  {
    name: 'quoth_promote_entity',
    description: 'Promote a project-scoped entity to global scope so all projects can match it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'quoth_recall_decisions',
    description: 'Recall past decisions matching a situation via semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string' },
        limit: { type: 'number', default: 5 },
        project: { type: 'string' },
      },
      required: ['situation'],
    },
  },
  {
    name: 'quoth_recall_anti_patterns',
    description: 'Recall past anti-patterns relevant to a situation.',
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string' },
        limit: { type: 'number', default: 5 },
        project: { type: 'string' },
      },
      required: ['situation'],
    },
  },
  {
    name: 'quoth_recall_global',
    description: 'Cross-project semantic search against globally-scoped entities only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'quoth_log_decision',
    description: 'Record an agent-driven decision as a knowledge entity of kind=decision.',
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        choice: { type: 'string' },
        reasoning: { type: 'string' },
        project: { type: 'string' },
      },
      required: ['situation', 'choice'],
    },
  },
  {
    name: 'quoth_log_anti_pattern',
    description: 'Record an agent-driven anti-pattern as a knowledge entity of kind=anti_pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'string' },
        what_not_to_do: { type: 'string' },
        why_failed: { type: 'string' },
        project: { type: 'string' },
      },
      required: ['condition', 'what_not_to_do'],
    },
  },
  {
    name: 'quoth_health',
    description: 'Daemon state: pid, queue depth, error counts, budget, stuck files.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'quoth_replay_session',
    description: 'Dry-run replay of a trajectory JSONL from error/ without writing to the DB.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
]

function scopeFor(project) {
  if (!project || project === 'global') return 'global'
  return `project:${project}`
}

async function handle(name, args, db) {
  const ke = require('../../daemon/lib/knowledge-entities.js')
  args = args || {}

  switch (name) {
    case 'quoth_top_entities': {
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 5
      let rows
      if (args.kind) {
        rows = ke.searchByKind(args.kind, limit)
      } else {
        rows = db.prepare(
          `SELECT * FROM knowledge_entities WHERE status = 'active' ORDER BY confidence DESC LIMIT ?`
        ).all(limit)
      }
      return { count: rows.length, entities: rows }
    }

    case 'quoth_search_entities': {
      const urlPath = buildInjectUrl({
        prompt: args.query,
        project: args.project,
        kinds: args.kinds,
        limit: args.limit || 5,
      })
      try {
        const resp = await fetchDaemon(urlPath)
        const results = (resp && resp.results) || []
        return { count: results.length, entities: results }
      } catch (err) {
        return { count: 0, entities: [], error: err.message }
      }
    }

    case 'quoth_recall_decisions': {
      const urlPath = buildInjectUrl({
        prompt: args.situation,
        project: args.project,
        kinds: ['decision'],
        limit: args.limit || 5,
      })
      try {
        const resp = await fetchDaemon(urlPath)
        return { count: (resp.results || []).length, entities: resp.results || [] }
      } catch (err) {
        return { count: 0, entities: [], error: err.message }
      }
    }

    case 'quoth_recall_anti_patterns': {
      const urlPath = buildInjectUrl({
        prompt: args.situation,
        project: args.project,
        kinds: ['anti_pattern'],
        limit: args.limit || 5,
      })
      try {
        const resp = await fetchDaemon(urlPath)
        return { count: (resp.results || []).length, entities: resp.results || [] }
      } catch (err) {
        return { count: 0, entities: [], error: err.message }
      }
    }

    case 'quoth_recall_global': {
      const urlPath = buildInjectUrl({
        prompt: args.query,
        project: 'global',
        kinds: args.kinds,
        limit: args.limit || 5,
      })
      try {
        const resp = await fetchDaemon(urlPath)
        return { count: (resp.results || []).length, entities: resp.results || [] }
      } catch (err) {
        return { count: 0, entities: [], error: err.message }
      }
    }

    case 'quoth_score_entity': {
      const row = ke.getById(args.id)
      if (!row) return { error: `Entity '${args.id}' not found` }
      if (args.outcome === 'success') {
        db.prepare(`
          UPDATE knowledge_entities
             SET alpha = alpha + 1,
                 confidence = (alpha + 1.0) / (alpha + 1.0 + beta),
                 updated_at = ?
           WHERE id = ?
        `).run(Date.now(), args.id)
      } else if (args.outcome === 'failure') {
        db.prepare(`
          UPDATE knowledge_entities
             SET beta = beta + 1,
                 confidence = alpha / (alpha + beta + 1.0),
                 updated_at = ?
           WHERE id = ?
        `).run(Date.now(), args.id)
      } else {
        return { error: `Unknown outcome '${args.outcome}'` }
      }
      const after = ke.getById(args.id)
      return { updated: true, entity: after }
    }

    case 'quoth_promote_entity': {
      const row = ke.getById(args.id)
      if (!row) return { error: `Entity '${args.id}' not found` }
      if (row.scope === 'global') return { alreadyGlobal: true, id: args.id }
      db.prepare(`
        UPDATE knowledge_entities
           SET scope = 'global', updated_at = ?
         WHERE id = ?
      `).run(Date.now(), args.id)
      return { promoted: true, id: args.id, previousScope: row.scope }
    }

    case 'quoth_log_decision': {
      const content = canonicalizeDecision(args)
      const scope = scopeFor(args.project)
      const row = ke.upsertEntity({
        kind: 'decision',
        scope,
        summary: (args.situation || '').slice(0, 120),
        content,
        metadata: {
          options: args.options || [],
          choice: args.choice || '',
          reasoning: args.reasoning || '',
        },
        tags: [],
        source: 'agent_logged',
        source_session_id: process.env.CLAUDE_SESSION_ID || null,
      })
      return { logged: true, id: row.id }
    }

    case 'quoth_log_anti_pattern': {
      const content = canonicalizeAntiPattern(args)
      const scope = scopeFor(args.project)
      const row = ke.upsertEntity({
        kind: 'anti_pattern',
        scope,
        summary: (args.condition || '').slice(0, 120),
        content,
        metadata: {
          what_not_to_do: args.what_not_to_do || '',
          why_failed: args.why_failed || '',
        },
        tags: [],
        source: 'agent_logged',
        source_session_id: process.env.CLAUDE_SESSION_ID || null,
      })
      return { logged: true, id: row.id }
    }

    case 'quoth_health': {
      try {
        return await fetchDaemon('/health')
      } catch (err) {
        return { error: err.message, daemon: null }
      }
    }

    case 'quoth_replay_session': {
      const sid = args.session_id
      if (!sid) return { error: 'session_id required', found: false }
      // Search error/YYYY-MM-DD/ buckets for a matching JSONL.
      const errorRoot = path.join(TRAJECTORIES_DIR, 'error')
      let foundFile = null
      try {
        if (fs.existsSync(errorRoot)) {
          for (const dateDir of fs.readdirSync(errorRoot)) {
            const candidate = path.join(errorRoot, dateDir, `${sid}.jsonl`)
            if (fs.existsSync(candidate)) { foundFile = candidate; break }
          }
        }
      } catch {}
      if (!foundFile) return { session_id: sid, found: false }
      let entryCount = 0
      try {
        const content = fs.readFileSync(foundFile, 'utf8')
        entryCount = content.split('\n').filter((l) => l.trim().length > 0).length
      } catch {}
      return {
        session_id: sid,
        found: true,
        file: foundFile,
        entry_count: entryCount,
        dry_run: true,
        note: 'Replay is a dry-run: pipeline would re-extract from this JSONL; nothing is written to the DB.',
      }
    }

    default:
      return null
  }
}

module.exports = { TOOLS, handle }
