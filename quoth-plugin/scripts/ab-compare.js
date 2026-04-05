#!/usr/bin/env node
/**
 * V1 vs V2 A/B comparison over the last 7 days.
 * Prints side-by-side metrics for quick sanity check.
 */

'use strict'

const path = require('path')
const os = require('os')
const { createDb } = require('../daemon/db.js')

const dbPath = process.env.QUOTH_DB_PATH || path.join(os.homedir(), '.quoth', 'memory.db')
const db = createDb(dbPath)

const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

console.log('===  V1 (Thompson+trigram, exposure tracking, 7d) ===')
const v1 = db.prepare(`
  SELECT AVG(confidence) avg_conf, COUNT(*) n,
         AVG(CASE WHEN exposure_count > 0 THEN success_count * 1.0 / exposure_count ELSE NULL END) conv
  FROM patterns
  WHERE exposure_count > 0 AND last_exposed_at > ?
`).get(weekAgo)
console.log(`  exposed patterns: ${v1.n}`)
console.log(`  avg confidence:   ${(v1.avg_conf * 100).toFixed(1)}%`)
console.log(`  avg conversion:   ${v1.conv != null ? (v1.conv * 100).toFixed(1) + '%' : 'n/a'}`)

console.log('\n===  V2 (hierarchical TS + SNIPS, injection_log, 7d) ===')
const v2 = db.prepare(`
  SELECT AVG(reward) avg_reward, COUNT(*) n,
         SUM(CASE WHEN is_exploration=1 THEN 1 ELSE 0 END) explorations,
         AVG(propensity) avg_prop
  FROM injection_log
  WHERE outcome_at IS NOT NULL AND injected_at > ?
`).get(weekAgo)
console.log(`  completed injections: ${v2.n}`)
console.log(`  avg reward:           ${v2.avg_reward != null ? (v2.avg_reward * 100).toFixed(1) + '%' : 'n/a'}`)
console.log(`  exploration slots:    ${v2.explorations || 0} (${v2.n ? ((v2.explorations || 0) / v2.n * 100).toFixed(1) : 0}%)`)
console.log(`  avg propensity:       ${v2.avg_prop != null ? v2.avg_prop.toFixed(3) : 'n/a'}`)

console.log('\n===  Cluster health ===')
const clusters = db.prepare(`
  SELECT COUNT(*) count, AVG(alpha/(alpha+beta)) avg_conf, SUM(member_count) members
  FROM cluster_stats
`).get()
console.log(`  clusters:      ${clusters.count || 0}`)
console.log(`  members:       ${clusters.members || 0}`)
console.log(`  avg conf:      ${clusters.avg_conf != null ? (clusters.avg_conf * 100).toFixed(1) + '%' : 'n/a'}`)

console.log('\n===  Quality status ===')
const quality = db.prepare(`
  SELECT
    SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
    SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) archived,
    SUM(CASE WHEN retired_reason IS NOT NULL THEN 1 ELSE 0 END) retired,
    AVG(distinctiveness) avg_distinctiveness
  FROM patterns
`).get()
console.log(`  active:         ${quality.active || 0}`)
console.log(`  archived:       ${quality.archived || 0}`)
console.log(`  retired:        ${quality.retired || 0}`)
console.log(`  avg distinct:   ${quality.avg_distinctiveness != null ? quality.avg_distinctiveness.toFixed(3) : 'n/a'}`)

if (v1.avg_conf != null && v2.avg_reward != null) {
  const delta = (v2.avg_reward - v1.avg_conf) * 100
  console.log(`\n===  Delta: V2 reward − V1 confidence = ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp ===`)
}
