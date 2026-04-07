'use strict'

const crypto = require('crypto')
const { execSync } = require('child_process')

const PROMPT = `Extract 1-3 reusable patterns from this AI agent session.

Session summary:
- Project: {{project}}
- Tool calls: {{tool_summary}}
- Success rate: {{success_rate}}
- Overall outcome: {{outcome}}

User intents during session:
{{user_intents}}

Key actions and LLM reasoning:
{{actions}}

RULES:
- Each pattern MUST describe a TECHNIQUE or STRATEGY, not a specific file/command
- NEVER include file paths, directory names, or raw commands
- Focus on WHAT workflow/approach worked and WHY
- Patterns should be applicable across projects
- Extract the SESSION-LEVEL insight: how did the sequence of actions achieve the goal?
- If the session was just routine work (git status, ls, etc.), return an empty array

GOOD session-level patterns:
- "Search-then-edit workflow: grep all references before renaming across files"
- "Incremental testing: run tests after each edit to catch regressions early"
- "Read-before-write: always read existing file before overwriting to preserve structure"
- "Parallel subagent dispatch for independent research tasks"

Respond with ONLY valid JSON (no markdown):
{"patterns": [{"pattern": "description (max 80 chars)", "tags": ["tag1","tag2"], "applicability": "broad|narrow"}]}`

function makeId(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12)
}

/**
 * Batch distill: process a session_summary entry along with its tool_use entries.
 * Produces 0-3 patterns from the entire session context.
 *
 * @param {Object} summaryEntry - The session_summary JSONL entry
 * @param {Object[]} toolEntries - The tool_use entries from the same session
 * @returns {Object[]} Array of distilled pattern objects
 */
async function distillBatch(summaryEntry, toolEntries) {
  // Build action summary from tool entries (most recent 30 to keep prompt size reasonable)
  const recentTools = toolEntries.slice(-30)
  const actions = recentTools.map((e, i) => {
    const parts = [`${i + 1}. [${e.tool}] ${(e.task || '').slice(0, 100)}`]
    if (e.llm_reasoning) parts.push(`   Reasoning: ${e.llm_reasoning.slice(0, 150)}`)
    if (e.outcome === 'failure') parts.push(`   FAILED`)
    return parts.join('\n')
  }).join('\n')

  const intents = (summaryEntry.user_intents || [])
    .map((intent, i) => `${i + 1}. ${intent}`)
    .join('\n') || 'No user intents captured'

  const prompt = PROMPT
    .replace('{{project}}', summaryEntry.project || 'unknown')
    .replace('{{tool_summary}}', summaryEntry.task || 'unknown')
    .replace('{{success_rate}}', `${Math.round((summaryEntry.success_rate || 0) * 100)}%`)
    .replace('{{outcome}}', summaryEntry.outcome || 'unknown')
    .replace('{{user_intents}}', intents)
    .replace('{{actions}}', actions || 'No actions captured')

  try {
    const raw = execSync(
      'claude -p --model claude-haiku-4-5-20251001 --output-format text --allowedTools ""',
      {
        input: prompt,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 512 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON in response')
    const result = JSON.parse(raw.slice(start))

    if (!result.patterns || !Array.isArray(result.patterns)) return []

    const validPatterns = result.patterns.slice(0, 3).filter(p => p.pattern && p.pattern.length >= 10)
    if (validPatterns.length === 0) return []

    // Batch embed all patterns in a single model pass
    let embeddings = validPatterns.map(() => null)
    try {
      const { generateEmbeddingBatch } = require('../lib/embed.js')
      embeddings = await generateEmbeddingBatch(validPatterns.map(p => p.pattern))
    } catch {}

    return validPatterns.map((p, i) => ({
      id: makeId(p.pattern),
      pattern: p.pattern.slice(0, 80),
      tags: p.tags || [],
      applicability: p.applicability || 'broad',
      embedding: embeddings[i],
      source: 'distilled'
    }))
  } catch {
    return []  // Batch distill failure is non-fatal — individual distill still works
  }
}

module.exports = { distillBatch }
