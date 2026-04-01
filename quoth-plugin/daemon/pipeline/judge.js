'use strict'

const PROMPT = `You are evaluating whether an AI agent action was effective.

Agent: {{agent}}
Task: {{task}}
Outcome: {{outcome}}
Attempts: {{attempts}}
Tools used: {{tool_calls}}

Was this agent action effective and did it achieve the task?

Respond with ONLY valid JSON (no markdown):
{"effective": true/false, "reason": "brief explanation", "category": "selector|wait|auth|data|env|general"}`

function judge(entry) {
  const prompt = PROMPT
    .replace('{{agent}}', entry.agent || 'unknown')
    .replace('{{task}}', entry.task || 'unknown')
    .replace('{{outcome}}', entry.outcome || 'unknown')
    .replace('{{attempts}}', String(entry.attempts || 1))
    .replace('{{tool_calls}}', String(entry.tool_calls || 0))

  try {
    const raw = require('child_process').execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model claude-haiku-4-5-20251001 --output-format text`,
      { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim()

    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON in response')
    const result = JSON.parse(raw.slice(start))
    return {
      effective: Boolean(result.effective),
      reason: result.reason || '',
      category: result.category || 'general'
    }
  } catch (err) {
    return {
      effective: entry.outcome === 'success',
      reason: 'fallback: claude unavailable',
      category: 'general',
      fallback: true,
      error: err.message
    }
  }
}

module.exports = { judge }
