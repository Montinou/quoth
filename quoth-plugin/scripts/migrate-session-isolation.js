#!/usr/bin/env node
'use strict'

// One-shot migration for legacy <project>-<date>.jsonl files into the
// per-session layout introduced in spec §4.1. Safe to run on a fresh
// install (no-op) and safe to run multiple times (idempotent — files
// already in migrated-legacy/ are skipped).
//
// Usage:
//   node quoth-plugin/scripts/migrate-session-isolation.js
//   node quoth-plugin/scripts/migrate-session-isolation.js --dry-run

const fs = require('fs')
const path = require('path')
const os = require('os')

const LEGACY_NAME_RE = /^(.+)-(\d{4}-\d{2}-\d{2})\.jsonl$/

function migrate({ home = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth'), dryRun = false } = {}) {
  const trajDir = path.join(home, 'trajectories')
  if (!fs.existsSync(trajDir)) return { migrated: 0, sessions: 0, skipped: 0 }

  const migratedDir = path.join(trajDir, 'migrated-legacy')
  const activeDir = path.join(trajDir, 'active')
  const processingDir = path.join(trajDir, 'processing')
  const emptyDir = path.join(trajDir, 'empty')

  if (!dryRun) {
    fs.mkdirSync(migratedDir, { recursive: true })
    fs.mkdirSync(activeDir, { recursive: true })
    fs.mkdirSync(processingDir, { recursive: true })
    fs.mkdirSync(emptyDir, { recursive: true })
  }

  const entries = fs.readdirSync(trajDir, { withFileTypes: true })
  let migrated = 0
  let totalSessions = 0
  let skipped = 0

  for (const d of entries) {
    if (!d.isFile()) continue
    const match = LEGACY_NAME_RE.exec(d.name)
    if (!match) continue

    const filePath = path.join(trajDir, d.name)
    const project = match[1]
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n').filter(Boolean)

    // Group by session id.
    const bySession = new Map()
    for (const raw of lines) {
      let parsed
      try { parsed = JSON.parse(raw) } catch { continue }
      const sid = parsed.session || parsed.session_id
      if (!sid) continue
      if (!bySession.has(sid)) bySession.set(sid, { tool: [], summary: null, any: [] })
      const bucket = bySession.get(sid)
      bucket.any.push(parsed)
      if (parsed.event === 'tool_use') bucket.tool.push(parsed)
      else if (parsed.event === 'session_summary') bucket.summary = parsed
    }

    for (const [sid, bucket] of bySession) {
      totalSessions++
      // Spec §7.1: NO trivial gate. The ONLY thing that sends a legacy
      // session to empty/ is having zero tool_use entries. Everything
      // else — even a 1-entry session — goes to processing/ so the
      // extractor gets a chance to decide productive vs routine.
      const entryCount = bucket.tool.length
      const isEmpty = entryCount === 0
      const destDir = isEmpty ? emptyDir : processingDir
      const destJsonl = path.join(destDir, `${sid}.jsonl`)
      const destMeta = path.join(destDir, `${sid}.meta.json`)

      // Idempotent: skip if already migrated.
      if (fs.existsSync(destJsonl)) { skipped++; continue }

      // Serialize bucket.any in original order.
      let body = bucket.any.map(e => JSON.stringify(e)).join('\n')

      // Non-empty session without summary → synthesize one so the daemon
      // has a reliable entrypoint when it picks up the file.
      if (!bucket.summary && !isEmpty) {
        const synth = synthesizeSummary(sid, project, bucket.tool)
        body += '\n' + JSON.stringify(synth)
      }

      const sidecar = {
        session_id: sid,
        project,
        status: isEmpty ? 'empty' : 'terminated',
        first_seen_ts: bucket.any[0]?.timestamp || Date.now(),
        last_seen_ts: bucket.any[bucket.any.length - 1]?.timestamp || Date.now(),
        tool_count: entryCount,
        closed_marker: Boolean(bucket.summary) || (!isEmpty),
        source: 'migration',
        ...(isEmpty ? { empty_reason: 'no-tool-use' } : {}),
      }

      if (!dryRun) {
        fs.writeFileSync(destJsonl, body + '\n')
        fs.writeFileSync(destMeta, JSON.stringify(sidecar))
      }
    }

    // Move the legacy file aside.
    if (!dryRun) {
      fs.renameSync(filePath, path.join(migratedDir, d.name))
      migrated++
    }
  }

  return { migrated, sessions: totalSessions, skipped }
}

function synthesizeSummary(sid, project, toolEntries) {
  const toolCounts = {}
  let successes = 0, failures = 0
  for (const e of toolEntries) {
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
    if (e.outcome === 'success') successes++
    else if (e.outcome === 'failure') failures++
  }
  const toolSummary = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  return {
    event: 'session_summary',
    agent: 'claude-code',
    project,
    session: sid,
    task: `Session (migrated): ${toolEntries.length} tool calls (${toolSummary}). ${successes} ok, ${failures} fail.`,
    tool_counts: toolCounts,
    total_calls: toolEntries.length,
    success_rate: toolEntries.length > 0 ? successes / toolEntries.length : 0,
    outcome: failures === 0 ? 'success' : (successes > failures ? 'partial' : 'failure'),
    source: 'migration-synthesizer',
    timestamp: Date.now(),
  }
}

// CLI entrypoint.
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run')
  const result = migrate({ dryRun })
  console.log(`[migrate-session-isolation] migrated=${result.migrated} sessions=${result.sessions} skipped=${result.skipped}${dryRun ? ' (DRY RUN)' : ''}`)
}

module.exports = { migrate, synthesizeSummary }
