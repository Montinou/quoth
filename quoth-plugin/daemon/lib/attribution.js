'use strict'

/**
 * Extract reward signals from trajectory events for v2 attribution.
 *
 * Unlike v1 Jaccard-overlap (which conflates correlation with causation),
 * v2 attribution starts from session outcome (binary), refined later by
 * LLM-as-Judge pairwise comparison.
 */

/**
 * Graded session outcome reward (v2):
 *
 * Priority 1: session_summary event with explicit success_rate (0-1)
 *   ≥0.8 → 1.0, ≥0.5 → 0.7, >0 → 0.3, 0 → 0.0
 *
 * Priority 2: legacy outcome fields (backward compat)
 *   any failure → 0.0, any success → 1.0
 *
 * Priority 3: infer from tool mix
 *   writes + no errors → 0.8, writes + errors → 0.5,
 *   errors only → 0.2, unknown → 0.5
 */
function sessionOutcomeReward(events) {
  if (!events || events.length === 0) return 0.5

  // Priority 1: session_summary with success_rate
  const summary = events.find(e => e.event === 'session_summary')
  if (summary && typeof summary.success_rate === 'number') {
    if (summary.success_rate >= 0.8) return 1.0
    if (summary.success_rate >= 0.5) return 0.7
    if (summary.success_rate > 0)    return 0.3
    return 0.0
  }

  // Priority 2: legacy outcome fields (backward compat)
  const hasFailure = events.some(e => e.outcome === 'failure' || e.outcome === 'error')
  if (hasFailure) return 0.0
  const hasSuccess = events.some(e => e.outcome === 'success')
  if (hasSuccess) return 1.0

  // Priority 3: infer from tool mix
  const writes = events.filter(e => ['Write', 'Edit', 'MultiEdit'].includes(e.tool)).length
  const bashErrors = events.filter(e => e.tool === 'Bash' && e.exit_code > 0).length

  if (writes > 0 && bashErrors === 0) return 0.8
  if (writes > 0 && bashErrors > 0)   return 0.5
  if (bashErrors > 0 && writes === 0) return 0.2
  return 0.5
}

/**
 * Extract tools, files, and commands touched in a session trajectory.
 * Used to build a compact session summary for the LLM judge.
 */
function extractSessionSignals(events) {
  const tools = new Set()
  const files = new Set()
  const commands = new Set()
  const FILE_RE = /(\/[^\s"']+?\.(ts|tsx|js|jsx|py|go|rs|md|json|sql|sh|yml|yaml|toml))/g
  for (const e of events || []) {
    if (e.tool) tools.add(e.tool)
    const task = e.task || ''
    FILE_RE.lastIndex = 0
    let m
    while ((m = FILE_RE.exec(task)) !== null) files.add(m[1])
    if (e.tool === 'Bash') {
      // Extract the base command name, handling paths like /usr/bin/npm → "npm"
      const token = task.split(/\s+/).find(w => w && w !== 'Bash') || ''
      const withoutPath = token.split('/').pop() || ''
      const cleaned = withoutPath.replace(/[^\w.-]/g, '')
      if (cleaned) commands.add(cleaned)
    }
  }
  return { tools: [...tools], files: [...files], commands: [...commands] }
}

/**
 * Summarize session events into a compact string for the LLM judge prompt.
 */
function summarizeSession(events, maxLen = 500) {
  const sig = extractSessionSignals(events)
  const toolSummary = sig.tools.slice(0, 5).join(', ')
  const fileSummary = sig.files.slice(0, 3).join(', ')
  const cmdSummary = sig.commands.slice(0, 5).join(', ')
  const outcome = sessionOutcomeReward(events)
  const parts = []
  if (toolSummary) parts.push(`Tools: ${toolSummary}`)
  if (fileSummary) parts.push(`Files: ${fileSummary}`)
  if (cmdSummary) parts.push(`Commands: ${cmdSummary}`)
  parts.push(`Outcome: ${outcome.toFixed(1)}`)
  return parts.join(' | ').slice(0, maxLen)
}

module.exports = { sessionOutcomeReward, extractSessionSignals, summarizeSession }
