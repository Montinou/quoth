'use strict'

// PageRank, trigram matching, and Jaccard similarity — ported from intelligence.cjs

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same',
  'than', 'too', 'very', 'just', 'because', 'if', 'when', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its',
])

function tokenize(text) {
  if (!text) return []
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

function trigrams(words) {
  const t = new Set()
  for (const w of words) {
    for (let i = 0; i <= w.length - 3; i++) t.add(w.slice(i, i + 3))
  }
  return t
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) { if (setB.has(item)) intersection++ }
  return intersection / (setA.size + setB.size - intersection)
}

function computePageRank(nodes, edges, damping, maxIter) {
  damping = damping || 0.85
  maxIter = maxIter || 30
  const ids = Object.keys(nodes)
  const n = ids.length
  if (n === 0) return {}

  const outLinks = {}
  const inLinks = {}
  for (const id of ids) { outLinks[id] = []; inLinks[id] = [] }
  for (const edge of edges) {
    if (outLinks[edge.sourceId]) outLinks[edge.sourceId].push(edge.targetId)
    if (inLinks[edge.targetId]) inLinks[edge.targetId].push(edge.sourceId)
  }

  const ranks = {}
  for (const id of ids) ranks[id] = 1 / n

  for (let iter = 0; iter < maxIter; iter++) {
    const newRanks = {}
    let diff = 0
    let danglingSum = 0
    for (const id of ids) {
      if (outLinks[id].length === 0) danglingSum += ranks[id]
    }
    for (const id of ids) {
      let sum = 0
      for (const src of inLinks[id]) {
        const outCount = outLinks[src].length
        if (outCount > 0) sum += ranks[src] / outCount
      }
      newRanks[id] = (1 - damping) / n + damping * (sum + danglingSum / n)
      diff += Math.abs(newRanks[id] - ranks[id])
    }
    for (const id of ids) ranks[id] = newRanks[id]
    if (diff < 1e-6) break
  }
  return ranks
}

function buildEdges(entries) {
  const edges = []
  const byCategory = {}
  for (const entry of entries) {
    const cat = entry.category || entry.namespace || 'default'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(entry)
  }

  // Temporal edges: entries from same sourceFile
  const byFile = {}
  for (const entry of entries) {
    const file = (entry.metadata && entry.metadata.sourceFile) || null
    if (file) {
      if (!byFile[file]) byFile[file] = []
      byFile[file].push(entry)
    }
  }
  for (const file of Object.keys(byFile)) {
    const group = byFile[file]
    for (let i = 0; i < group.length - 1; i++) {
      edges.push({ sourceId: group[i].id, targetId: group[i + 1].id, type: 'temporal', weight: 0.5 })
    }
  }

  // Similarity edges within categories (Jaccard > 0.3)
  for (const cat of Object.keys(byCategory)) {
    const group = byCategory[cat]
    for (let i = 0; i < group.length; i++) {
      const triA = trigrams(tokenize(group[i].content || group[i].summary || ''))
      for (let j = i + 1; j < group.length; j++) {
        const triB = trigrams(tokenize(group[j].content || group[j].summary || ''))
        const sim = jaccardSimilarity(triA, triB)
        if (sim > 0.3) {
          edges.push({ sourceId: group[i].id, targetId: group[j].id, type: 'similar', weight: sim })
        }
      }
    }
  }
  return edges
}

module.exports = { tokenize, trigrams, jaccardSimilarity, computePageRank, buildEdges }
