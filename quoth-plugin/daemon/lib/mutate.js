'use strict'

const PROMPT = `You are generating targeted mutations to verify a Playwright test catches real failures.

Test file: {{testFile}}
Feature: {{feature}}
Test code:
{{testCode}}

Generate 2-3 targeted mutations to the APPLICATION code (NOT the test code) that should cause this test to FAIL. Each mutation should break a specific behavior the test is supposed to verify.

Good mutations:
- Comment out a DOM element the test asserts on
- Change an API response value the test checks
- Break a navigation route the test follows
- Remove a click handler the test triggers

Bad mutations (avoid):
- Syntax errors that prevent compilation
- Changes unrelated to what the test verifies
- Changes to the test file itself

Respond with ONLY valid JSON array:
[{"description":"what this mutation does","file":"src/path/to/file.ext","line":42,"original":"original code","mutated":"mutated code"}]`

async function generateMutations({ testFile, feature, testCode }) {
  const fs = require('fs')
  let code = testCode || ''
  if (!code && testFile) {
    try { code = fs.readFileSync(testFile, 'utf8') } catch {}
  }

  const prompt = PROMPT
    .replace('{{testFile}}', testFile || 'unknown')
    .replace('{{feature}}', feature || 'unknown')
    .replace('{{testCode}}', code.slice(0, 3000))

  try {
    const proc = require('child_process').spawnSync(
      'claude', ['-p', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text'],
      { input: prompt, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    if (proc.status !== 0) return []
    const raw = (proc.stdout || '').trim()
    const start = raw.indexOf('[')
    if (start === -1) return []
    return JSON.parse(raw.slice(start))
  } catch {
    return []
  }
}

module.exports = { generateMutations }
