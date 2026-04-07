'use strict'

const { execSync } = require('child_process')

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

async function consolidate(newPattern, existingPatterns) {
  const prompt = PROMPT
    .replace('{{new_pattern}}', JSON.stringify(newPattern))
    .replace('{{existing_patterns}}', JSON.stringify(existingPatterns.slice(0, 3)))

  try {
    const raw = execSync(
      'claude -p --model claude-haiku-4-5-20251001 --output-format text --allowedTools ""',
      { input: prompt, encoding: 'utf8', timeout: 60000, maxBuffer: 512 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const start = raw.indexOf('{')
    if (start === -1) throw new Error('No JSON in response')
    const end = raw.lastIndexOf('}')
    if (end === -1) throw new Error('No closing brace')
    const result = JSON.parse(raw.slice(start, end + 1))
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
