'use strict'

const crypto = require('crypto')

const PROMPT = `You are extracting a reusable pattern from a successful AI agent action.

Agent: {{agent}}
Task: {{task}}
Pattern that was used: {{pattern_used}}
Context: {{context}}

Extract ONE concise, generalizable pattern that other agents can reuse.

Respond with ONLY valid JSON (no markdown):
{"pattern": "clear description of the reusable pattern", "tags": ["tag1","tag2"], "applicability": "broad|narrow"}`

function makeId(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12)
}

async function distill(entry) {
  const prompt = PROMPT
    .replace('{{agent}}', entry.agent || 'unknown')
    .replace('{{task}}', entry.task || 'unknown')
    .replace('{{pattern_used}}', entry.pattern_used || 'none')
    .replace('{{context}}', JSON.stringify({ attempts: entry.attempts, tool_calls: entry.tool_calls }))

  try {
    const proc = require('child_process').spawnSync(
      'claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { input: prompt, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    if (proc.status !== 0) throw new Error('claude subprocess failed')
    const raw = (proc.stdout || '').trim()

    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON')
    const result = JSON.parse(raw.slice(start))
    const id = makeId(result.pattern)
    let embedding = null
    try {
      const { generateEmbedding } = require('../lib/embed.js')
      embedding = await generateEmbedding(result.pattern)
    } catch {}
    return { id, pattern: result.pattern, tags: result.tags || [], applicability: result.applicability || 'narrow', embedding, source: 'distilled' }
  } catch (err) {
    const fallbackContent = entry.pattern_used || `${entry.agent}: ${entry.task}`
    return {
      id: makeId(fallbackContent),
      pattern: fallbackContent,
      tags: [],
      applicability: 'narrow',
      fallback: true,
      error: err.message,
      embedding: null,
      source: 'distilled'
    }
  }
}

module.exports = { distill }
