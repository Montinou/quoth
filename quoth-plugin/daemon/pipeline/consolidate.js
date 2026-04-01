'use strict'

const PROMPT = `You are deciding how to add a new pattern to a knowledge base.

New pattern:
{{new_pattern}}

Existing similar patterns (top 3):
{{existing_patterns}}

Should you:
- "strengthen": merge into an existing pattern (essentially the same idea)
- "new": add as a distinct new pattern (genuinely different)

Respond with ONLY valid JSON (no markdown):
{"action": "strengthen|new", "targetId": "id of target if strengthen, else null", "updated": {the final pattern object}}`

function consolidate(newPattern, existingPatterns) {
  const prompt = PROMPT
    .replace('{{new_pattern}}', JSON.stringify(newPattern))
    .replace('{{existing_patterns}}', JSON.stringify(existingPatterns.slice(0, 3)))

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
    return {
      action: result.action || 'new',
      targetId: result.targetId || null,
      updated: result.updated || newPattern
    }
  } catch (err) {
    return { action: 'new', targetId: null, updated: newPattern, fallback: true, error: err.message }
  }
}

module.exports = { consolidate }
