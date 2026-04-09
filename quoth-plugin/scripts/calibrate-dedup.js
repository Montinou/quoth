#!/usr/bin/env node
'use strict'

/**
 * Dedup Threshold Calibration Script
 *
 * Analyzes pairwise cosine similarity among top patterns to determine
 * the optimal dedup threshold for MiniLM-L6 384d embeddings.
 *
 * Usage: node scripts/calibrate-dedup.js [--db PATH] [--top N] [--min 0.85] [--max 0.95]
 */

const path = require('path')
const os = require('os')

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

function computePairwiseSimilarity(patterns) {
  const valid = patterns.filter(p => p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0)
  if (valid.length < 2) return []

  const pairs = []
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const sim = cosineSimilarity(valid[i].embedding, valid[j].embedding)
      pairs.push({
        idA: valid[i].id,
        idB: valid[j].id,
        nameA: valid[i].name || valid[i].id,
        nameB: valid[j].name || valid[j].id,
        similarity: sim,
      })
    }
  }
  return pairs
}

function bucketPairs(pairs, min = 0.85, max = 0.95) {
  const buckets = {
    'below': [],
    '0.85-0.88': [],
    '0.88-0.90': [],
    '0.90-0.92': [],
    '0.92-0.95': [],
    'above': [],
  }
  for (const p of pairs) {
    if (p.similarity < min) buckets['below'].push(p)
    else if (p.similarity < 0.88) buckets['0.85-0.88'].push(p)
    else if (p.similarity < 0.90) buckets['0.88-0.90'].push(p)
    else if (p.similarity < 0.92) buckets['0.90-0.92'].push(p)
    else if (p.similarity < max) buckets['0.92-0.95'].push(p)
    else buckets['above'].push(p)
  }
  return buckets
}

function recommendThreshold(buckets) {
  const count88_90 = (buckets['0.88-0.90'] || []).length
  const count90_92 = (buckets['0.90-0.92'] || []).length
  const count92_95 = (buckets['0.92-0.95'] || []).length

  // If many pairs cluster below 0.92, real dupes exist there -> lower threshold
  if (count88_90 + count90_92 > 10) {
    return {
      threshold: 0.88,
      reason: `${count88_90 + count90_92} pairs in 0.88-0.92 range — many near-dupes, lower threshold recommended`,
    }
  }
  if (count90_92 > 5) {
    return {
      threshold: 0.90,
      reason: `${count90_92} pairs in 0.90-0.92 range — moderate near-dupes, slightly lower threshold`,
    }
  }
  return {
    threshold: 0.92,
    reason: `Few pairs below 0.92 (${count88_90 + count90_92}) — default threshold is appropriate`,
  }
}

// --- CLI entry point ---
async function main() {
  const args = process.argv.slice(2)
  const dbFlag = args.indexOf('--db')
  const topFlag = args.indexOf('--top')

  const dbPath = dbFlag >= 0 ? args[dbFlag + 1] : path.join(os.homedir(), '.quoth', 'memory.db')
  const topN = topFlag >= 0 ? parseInt(args[topFlag + 1], 10) : 100

  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  const rows = db.prepare(`
    SELECT id, name, action, embedding, confidence
    FROM patterns
    WHERE status = 'active' AND embedding IS NOT NULL
    ORDER BY confidence DESC
    LIMIT ?
  `).all(topN)

  console.log(`\nLoaded ${rows.length} patterns from ${dbPath}\n`)

  const patterns = rows.map(r => ({
    id: r.id,
    name: r.name,
    action: (r.action || '').slice(0, 80),
    confidence: r.confidence,
    embedding: JSON.parse(r.embedding),
  }))

  console.log('Computing pairwise similarity...')
  const pairs = computePairwiseSimilarity(patterns)
  console.log(`Total pairs: ${pairs.length}\n`)

  const buckets = bucketPairs(pairs)

  console.log('=== Similarity Distribution ===')
  console.log(`Below 0.85:  ${buckets['below'].length} pairs`)
  console.log(`0.85-0.88:   ${buckets['0.85-0.88'].length} pairs`)
  console.log(`0.88-0.90:   ${buckets['0.88-0.90'].length} pairs`)
  console.log(`0.90-0.92:   ${buckets['0.90-0.92'].length} pairs`)
  console.log(`0.92-0.95:   ${buckets['0.92-0.95'].length} pairs`)
  console.log(`Above 0.95:  ${buckets['above'].length} pairs`)

  // Show borderline pairs for manual review
  const borderline = [...(buckets['0.88-0.90'] || []), ...(buckets['0.90-0.92'] || []), ...(buckets['0.92-0.95'] || [])]
  borderline.sort((a, b) => b.similarity - a.similarity)

  if (borderline.length > 0) {
    console.log(`\n=== Borderline Pairs (0.88-0.95) — ${borderline.length} pairs ===`)
    console.log('Review these to classify as "same technique" or "different technique":\n')
    for (const p of borderline.slice(0, 30)) {
      console.log(`[${p.similarity.toFixed(4)}] "${p.nameA}" vs "${p.nameB}"`)
    }
    if (borderline.length > 30) {
      console.log(`  ... and ${borderline.length - 30} more`)
    }
  }

  const recommendation = recommendThreshold(buckets)
  console.log(`\n=== Recommendation ===`)
  console.log(`Threshold: ${recommendation.threshold}`)
  console.log(`Reason: ${recommendation.reason}`)
  console.log(`\nSet via: export QUOTH_DEDUP_THRESHOLD=${recommendation.threshold}`)

  db.close()
}

// Export helpers for testing
module.exports = { computePairwiseSimilarity, bucketPairs, recommendThreshold, cosineSimilarity }

// Run CLI if invoked directly
if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1) })
}
