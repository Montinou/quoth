'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { tokenize, trigrams, jaccardSimilarity, computePageRank, buildEdges } = require('../lib/graph')
const { routeTask, getAlternatives } = require('../lib/routing')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const STATE_DIR = path.join(QUOTH_HOME, 'intelligence')

const TOOLS = [
  {
    name: 'quoth_route_task',
    description: 'Route a task to the optimal agent type based on keyword matching and learned patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description to route' }
      },
      required: ['task']
    }
  },
  {
    name: 'quoth_intelligence_init',
    description: 'Initialize the intelligence graph from memory entries and patterns. Call at session start.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'quoth_intelligence_context',
    description: 'Get ranked context entries relevant to a prompt. Uses trigram matching + PageRank.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to find context for' },
        topK: { type: 'number', default: 5 }
      },
      required: ['prompt']
    }
  },
  {
    name: 'quoth_intelligence_consolidate',
    description: 'Process pending edits, rebuild graph edges, recompute PageRank. Call at session end.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'quoth_intelligence_stats',
    description: 'Get intelligence diagnostics: graph health, confidence distribution, PageRank, trends.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'quoth_intelligence_feedback',
    description: 'Record success/failure feedback for last-matched patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the task succeeded' }
      },
      required: ['success']
    }
  }
]

// --- State helpers (file-based, same as intelligence.cjs) ---

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true })
}

function readJSON(filename) {
  const filePath = path.join(STATE_DIR, filename)
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {}
  return null
}

function writeJSON(filename, data) {
  ensureStateDir()
  fs.writeFileSync(path.join(STATE_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}

// --- Bootstrap from MEMORY.md files ---

function bootstrapFromMemoryFiles() {
  const entries = []
  const homeDir = os.homedir()
  const candidates = [
    path.join(homeDir, '.claude', 'projects'),
    path.join(homeDir, '.quoth', 'memory'),
  ]

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    if (base.endsWith('projects')) {
      try {
        for (const pdir of fs.readdirSync(base)) {
          const memDir = path.join(base, pdir, 'memory')
          if (fs.existsSync(memDir)) parseMemoryDir(memDir, entries)
        }
      } catch {}
    } else {
      parseMemoryDir(base, entries)
    }
  }
  return entries
}

function parseMemoryDir(dir, entries) {
  try {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const filePath = path.join(dir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      if (!content.trim()) continue
      const sections = content.split(/^##?\s+/m).filter(Boolean)
      for (const section of sections) {
        const lines = section.trim().split('\n')
        const title = lines[0].trim()
        const body = lines.slice(1).join('\n').trim()
        if (!body || body.length < 10) continue
        const id = `mem-${file.replace('.md', '')}-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30)}`
        entries.push({
          id, key: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50),
          content: body.slice(0, 500), summary: title,
          namespace: file === 'MEMORY.md' ? 'core' : file.replace('.md', ''),
          type: 'semantic',
          metadata: { sourceFile: filePath, bootstrapped: true },
          createdAt: Date.now(),
        })
      }
    }
  } catch {}
}

// --- Also bootstrap from quoth patterns DB ---

function bootstrapFromPatterns(db) {
  try {
    const patterns = db.getTopPatterns(50, [])
    return patterns.map(p => ({
      id: `pat-${p.id}`,
      key: p.name || p.id,
      content: `${p.condition || ''}\n${p.action || ''}`.trim(),
      summary: p.name || p.id,
      namespace: p.namespace || 'patterns',
      type: 'pattern',
      metadata: { confidence: p.confidence, source: p.source },
      createdAt: p.created_at || Date.now(),
    }))
  } catch { return [] }
}

// --- Core functions ---

function initGraph(db) {
  ensureStateDir()

  const graphState = readJSON('graph-state.json')
  let store = readJSON('store.json')

  if (!store || !Array.isArray(store) || store.length === 0) {
    const memEntries = bootstrapFromMemoryFiles()
    const patEntries = db ? bootstrapFromPatterns(db) : []
    store = [...memEntries, ...patEntries]
    if (store.length > 0) {
      writeJSON('store.json', store)
    } else {
      return { nodes: 0, edges: 0, message: 'No memory entries to index' }
    }
  }

  // Cache hit check
  if (graphState && graphState.nodeCount === store.length) {
    const age = Date.now() - (graphState.updatedAt || 0)
    if (age < 60000) {
      return { nodes: graphState.nodeCount, edges: (graphState.edges || []).length, message: 'Graph cache hit' }
    }
  }

  const nodes = {}
  for (const entry of store) {
    const id = entry.id || `entry-${Math.random().toString(36).slice(2, 8)}`
    nodes[id] = {
      id, category: entry.namespace || entry.type || 'default',
      confidence: (entry.metadata && entry.metadata.confidence) || 0.5,
      accessCount: (entry.metadata && entry.metadata.accessCount) || 0,
      createdAt: entry.createdAt || Date.now(),
    }
    entry.id = id
  }

  const edges = buildEdges(store)
  const pageRanks = computePageRank(nodes, edges, 0.85, 30)

  writeJSON('graph-state.json', {
    version: 1, updatedAt: Date.now(), nodeCount: Object.keys(nodes).length,
    nodes, edges, pageRanks,
  })

  const rankedEntries = store.map(entry => {
    const id = entry.id
    return {
      id, content: entry.content || entry.value || '',
      summary: entry.summary || entry.key || '',
      category: entry.namespace || entry.type || 'default',
      confidence: nodes[id] ? nodes[id].confidence : 0.5,
      pageRank: pageRanks[id] || 0,
      accessCount: nodes[id] ? nodes[id].accessCount : 0,
      words: tokenize((entry.content || '') + ' ' + (entry.summary || entry.key || '')),
    }
  }).sort((a, b) => (0.6 * b.pageRank + 0.4 * b.confidence) - (0.6 * a.pageRank + 0.4 * a.confidence))

  writeJSON('ranked-context.json', { version: 1, computedAt: Date.now(), entries: rankedEntries })

  return { nodes: Object.keys(nodes).length, edges: edges.length, message: 'Graph built and ranked' }
}

function getContext(prompt, topK) {
  if (!prompt) return { entries: [] }
  topK = topK || 5

  const ranked = readJSON('ranked-context.json')
  if (!ranked || !ranked.entries || ranked.entries.length === 0) return { entries: [] }

  const promptTrigrams = trigrams(tokenize(prompt))
  if (promptTrigrams.size === 0) return { entries: [] }

  const scored = []
  for (const entry of ranked.entries) {
    const entryTrigrams = trigrams(entry.words || [])
    const contentMatch = jaccardSimilarity(promptTrigrams, entryTrigrams)
    const score = 0.6 * contentMatch + 0.4 * (entry.pageRank || 0)
    if (score >= 0.05) scored.push({ ...entry, score })
  }

  scored.sort((a, b) => b.score - a.score)
  const topEntries = scored.slice(0, topK)

  // Track matched IDs for feedback loop
  writeJSON('last-matched.json', topEntries.map(e => e.id))

  return {
    count: topEntries.length,
    entries: topEntries.map(e => ({
      id: e.id, summary: (e.summary || e.content || '').slice(0, 80),
      score: +e.score.toFixed(3), confidence: +e.confidence.toFixed(3),
      pageRank: +(e.pageRank || 0).toFixed(4), accessCount: e.accessCount || 0,
    }))
  }
}

function applyFeedback(success) {
  const matchedIds = readJSON('last-matched.json')
  if (!matchedIds || !Array.isArray(matchedIds) || matchedIds.length === 0) {
    return { boosted: [] }
  }

  const amount = success ? 0.05 : -0.02
  const ranked = readJSON('ranked-context.json')
  const graph = readJSON('graph-state.json')

  if (ranked && ranked.entries) {
    for (const entry of ranked.entries) {
      if (matchedIds.includes(entry.id)) {
        entry.confidence = Math.max(0, Math.min(1, (entry.confidence || 0.5) + amount))
        entry.accessCount = (entry.accessCount || 0) + 1
      }
    }
    writeJSON('ranked-context.json', ranked)
  }

  if (graph && graph.nodes) {
    for (const id of matchedIds) {
      if (graph.nodes[id]) {
        graph.nodes[id].confidence = Math.max(0, Math.min(1, (graph.nodes[id].confidence || 0.5) + amount))
        graph.nodes[id].accessCount = (graph.nodes[id].accessCount || 0) + 1
      }
    }
    writeJSON('graph-state.json', graph)
  }

  return { boosted: matchedIds, amount }
}

function consolidateGraph(db) {
  ensureStateDir()

  let store = readJSON('store.json')
  if (!store || !Array.isArray(store)) {
    return { entries: 0, edges: 0, newEntries: 0, message: 'No store to consolidate' }
  }

  // Process pending edits
  let newEntries = 0
  const pendingPath = path.join(STATE_DIR, 'pending-insights.jsonl')
  if (fs.existsSync(pendingPath)) {
    const lines = fs.readFileSync(pendingPath, 'utf-8').trim().split('\n').filter(Boolean)
    const editCounts = {}
    for (const line of lines) {
      try {
        const insight = JSON.parse(line)
        if (insight.file) editCounts[insight.file] = (editCounts[insight.file] || 0) + 1
      } catch {}
    }
    for (const [file, count] of Object.entries(editCounts)) {
      if (count >= 3) {
        const exists = store.some(e => e.metadata && e.metadata.sourceFile === file && e.metadata.autoGenerated)
        if (!exists) {
          store.push({
            id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            key: `frequent-edit-${path.basename(file)}`,
            content: `File ${file} was edited ${count} times this session — likely a hot path.`,
            summary: `Frequently edited: ${path.basename(file)} (${count}x)`,
            namespace: 'insights', type: 'procedural',
            metadata: { sourceFile: file, editCount: count, autoGenerated: true },
            createdAt: Date.now(),
          })
          newEntries++
        }
      }
    }
    fs.writeFileSync(pendingPath, '', 'utf-8')
  }

  // Refresh from patterns DB
  if (db) {
    const patEntries = bootstrapFromPatterns(db)
    const existingIds = new Set(store.map(e => e.id))
    for (const pe of patEntries) {
      if (!existingIds.has(pe.id)) { store.push(pe); newEntries++ }
    }
  }

  // Confidence decay for unaccessed entries
  const graph = readJSON('graph-state.json')
  if (graph && graph.nodes) {
    const now = Date.now()
    for (const node of Object.values(graph.nodes)) {
      const hours = (now - (node.createdAt || now)) / (1000 * 60 * 60)
      if (node.accessCount === 0 && hours > 24) {
        node.confidence = Math.max(0.05, (node.confidence || 0.5) - 0.005 * Math.floor(hours / 24))
      }
    }
  }

  // Rebuild graph
  for (const entry of store) {
    if (!entry.id) entry.id = `entry-${Math.random().toString(36).slice(2, 8)}`
  }
  const edges = buildEdges(store)
  const nodes = {}
  for (const entry of store) {
    nodes[entry.id] = {
      id: entry.id, category: entry.namespace || entry.type || 'default',
      confidence: (graph && graph.nodes && graph.nodes[entry.id])
        ? graph.nodes[entry.id].confidence
        : (entry.metadata && entry.metadata.confidence) || 0.5,
      accessCount: (graph && graph.nodes && graph.nodes[entry.id])
        ? graph.nodes[entry.id].accessCount
        : (entry.metadata && entry.metadata.accessCount) || 0,
      createdAt: entry.createdAt || Date.now(),
    }
  }
  const pageRanks = computePageRank(nodes, edges, 0.85, 30)

  writeJSON('graph-state.json', {
    version: 1, updatedAt: Date.now(), nodeCount: Object.keys(nodes).length,
    nodes, edges, pageRanks,
  })

  const rankedEntries = store.map(entry => ({
    id: entry.id, content: entry.content || entry.value || '',
    summary: entry.summary || entry.key || '',
    category: entry.namespace || entry.type || 'default',
    confidence: nodes[entry.id] ? nodes[entry.id].confidence : 0.5,
    pageRank: pageRanks[entry.id] || 0,
    accessCount: nodes[entry.id] ? nodes[entry.id].accessCount : 0,
    words: tokenize((entry.content || '') + ' ' + (entry.summary || entry.key || '')),
  })).sort((a, b) => (0.6 * b.pageRank + 0.4 * b.confidence) - (0.6 * a.pageRank + 0.4 * a.confidence))

  writeJSON('ranked-context.json', { version: 1, computedAt: Date.now(), entries: rankedEntries })
  if (newEntries > 0) writeJSON('store.json', store)

  // Save snapshot
  saveSnapshot(nodes, edges, pageRanks, rankedEntries)

  return { entries: store.length, edges: edges.length, newEntries, message: 'Consolidated' }
}

function saveSnapshot(nodes, edges, pageRanks, rankedEntries) {
  const snap = {
    timestamp: Date.now(),
    nodes: Object.keys(nodes).length,
    edges: edges.length,
    pageRankSum: Object.values(pageRanks).reduce((s, v) => s + v, 0),
    confidences: Object.values(nodes).map(n => n.confidence || 0.5),
    accessCounts: Object.values(nodes).map(n => n.accessCount || 0),
    topPatterns: rankedEntries.slice(0, 10).map(e => ({
      id: e.id, summary: (e.summary || '').slice(0, 60),
      confidence: e.confidence || 0.5, pageRank: e.pageRank || 0,
      accessCount: e.accessCount || 0,
    })),
  }
  let history = readJSON('snapshots.json')
  if (!Array.isArray(history)) history = []
  history.push(snap)
  if (history.length > 50) history = history.slice(-50)
  writeJSON('snapshots.json', history)
}

function getStats(db) {
  const graph = readJSON('graph-state.json')
  const ranked = readJSON('ranked-context.json')
  const history = readJSON('snapshots.json') || []
  const pendingPath = path.join(STATE_DIR, 'pending-insights.jsonl')
  const pending = fs.existsSync(pendingPath)
    ? fs.readFileSync(pendingPath, 'utf-8').trim().split('\n').filter(Boolean).length : 0

  const nodeCount = graph ? Object.keys(graph.nodes || {}).length : 0
  const edgeCount = graph ? (graph.edges || []).length : 0
  const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0

  const confidences = []
  const accessCounts = []
  if (graph && graph.nodes) {
    for (const n of Object.values(graph.nodes)) {
      confidences.push(n.confidence || 0.5)
      accessCounts.push(n.accessCount || 0)
    }
  }
  confidences.sort((a, b) => a - b)

  let prMax = 0, prMaxId = ''
  if (graph && graph.pageRanks) {
    for (const [id, pr] of Object.entries(graph.pageRanks)) {
      if (pr > prMax) { prMax = pr; prMaxId = id }
    }
  }

  const topPatterns = (ranked && ranked.entries || []).slice(0, 10).map((e, i) => ({
    rank: i + 1, summary: (e.summary || '').slice(0, 60),
    confidence: +(e.confidence || 0.5).toFixed(3),
    pageRank: +(e.pageRank || 0).toFixed(4),
    accessed: e.accessCount || 0,
  }))

  const edgeTypes = {}
  if (graph && graph.edges) {
    for (const e of graph.edges) edgeTypes[e.type || 'unknown'] = (edgeTypes[e.type || 'unknown'] || 0) + 1
  }

  let delta = null
  if (history.length >= 2) {
    const prev = history[history.length - 2], curr = history[history.length - 1]
    delta = {
      elapsed: `${Math.round((curr.timestamp - prev.timestamp) / 60000)}m`,
      nodes: curr.nodes - prev.nodes, edges: curr.edges - prev.edges,
    }
  }

  let exposure = null, v2 = null
  if (db) {
    try {
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN exposure_count > 0 THEN 1 ELSE 0 END) as exposed,
          SUM(CASE WHEN success_count > 0 THEN 1 ELSE 0 END) as used,
          AVG(CASE WHEN exposure_count > 0 THEN (success_count * 1.0 / exposure_count) ELSE 0 END) as avg_conversion
        FROM patterns WHERE status = 'active'
      `).get()
      exposure = {
        total: row.total || 0,
        exposed: row.exposed || 0,
        used: row.used || 0,
        avg_conversion_rate: row.avg_conversion != null ? +row.avg_conversion.toFixed(4) : 0,
      }
    } catch {}
    try {
      const clusters = db.prepare(`
        SELECT COUNT(*) c, AVG(alpha/(alpha+beta)) avg_conf,
               MIN(alpha/(alpha+beta)) min_conf, MAX(alpha/(alpha+beta)) max_conf,
               SUM(attempts) total_attempts
        FROM cluster_stats
      `).get()
      const injections = db.prepare(`
        SELECT COUNT(*) total,
               SUM(CASE WHEN is_exploration=1 THEN 1 ELSE 0 END) explorations,
               AVG(propensity) avg_prop,
               COUNT(CASE WHEN outcome_at IS NOT NULL THEN 1 END) with_outcome,
               AVG(CASE WHEN reward IS NOT NULL THEN reward ELSE NULL END) avg_reward
        FROM injection_log WHERE injected_at > (strftime('%s','now') - 86400*7) * 1000
      `).get()
      const judge = db.prepare(`
        SELECT COUNT(*) total,
               SUM(CASE WHEN status='judged' THEN 1 ELSE 0 END) judged,
               SUM(cost_cents) cost_cents
        FROM judge_queue WHERE created_at > (strftime('%s','now') - 86400*30) * 1000
      `).get()
      const retired = db.prepare("SELECT COUNT(*) c FROM patterns WHERE retired_at IS NOT NULL").get()
      v2 = {
        clusters: clusters && clusters.c ? {
          count: clusters.c,
          avg_conf: +(clusters.avg_conf || 0).toFixed(3),
          min_conf: +(clusters.min_conf || 0).toFixed(3),
          max_conf: +(clusters.max_conf || 0).toFixed(3),
          total_attempts: clusters.total_attempts || 0,
        } : null,
        injections_7d: {
          total: injections.total || 0,
          explorations: injections.explorations || 0,
          avg_propensity: injections.avg_prop ? +injections.avg_prop.toFixed(3) : null,
          with_outcome: injections.with_outcome || 0,
          avg_reward: injections.avg_reward != null ? +injections.avg_reward.toFixed(3) : null,
        },
        judge_30d: {
          total: judge.total || 0,
          judged: judge.judged || 0,
          cost_cents: judge.cost_cents ? +judge.cost_cents.toFixed(2) : 0,
        },
        retired_total: retired.c || 0,
      }
    } catch {}
  }

  return {
    graph: { nodes: nodeCount, edges: edgeCount, density: +density.toFixed(4) },
    confidence: confidences.length ? {
      min: +confidences[0].toFixed(3), max: +confidences[confidences.length - 1].toFixed(3),
      mean: +(confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(3),
    } : { min: 0, max: 0, mean: 0 },
    access: { total: accessCounts.reduce((s, c) => s + c, 0), used: accessCounts.filter(c => c > 0).length },
    pageRank: { topNode: prMaxId, topNodeRank: +prMax.toFixed(4) },
    edgeTypes, pendingInsights: pending, snapshots: history.length,
    topPatterns, delta, exposure, v2,
  }
}

// --- Tool handler ---

async function handle(name, args, db) {
  switch (name) {
    case 'quoth_route_task': {
      const result = routeTask(args.task)
      const alternatives = getAlternatives(result.agent)
      // Enrich with intelligence context
      const context = getContext(args.task, 3)
      return { ...result, alternatives, relevantPatterns: context.entries || [] }
    }
    case 'quoth_intelligence_init':
      return initGraph(db)
    case 'quoth_intelligence_context':
      return getContext(args.prompt, args.topK)
    case 'quoth_intelligence_consolidate':
      return consolidateGraph(db)
    case 'quoth_intelligence_stats':
      return getStats(db)
    case 'quoth_intelligence_feedback':
      return applyFeedback(args.success)
    default:
      return null
  }
}

// Also export core functions for direct use in hooks (no MCP roundtrip needed)
module.exports = {
  TOOLS, handle,
  initGraph, getContext, applyFeedback, consolidateGraph, getStats, routeTask: routeTask,
}
