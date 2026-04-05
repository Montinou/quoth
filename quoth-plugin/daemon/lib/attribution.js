'use strict'

/**
 * Extract reward signals from trajectory events for v2 attribution.
 *
 * Unlike v1 Jaccard-overlap (which conflates correlation with causation),
 * v2 attribution starts from session outcome (binary), refined later by
 * LLM-as-Judge pairwise comparison.
 */

/**
 * Binary session outcome reward:
 * - any failure event present → 0.0
 * - only successes → 1.0
 * - no events or no outcome fields → 0.5 (null signal)
 */
function sessionOutcomeReward(events) {
  if (!events || events.length === 0) return 0.5
  const hasFailure = events.some(e => e.outcome === 'failure' || e.outcome === 'error')
  if (hasFailure) return 0.0
  const hasSuccess = events.some(e => e.outcome === 'success')
  if (hasSuccess) return 1.0
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
      const first = (task.split(/\s+/).find(w => w !== 'Bash' && w) || '').replace(/[^\w-]/g, '')
      if (first) commands.add(first)
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
