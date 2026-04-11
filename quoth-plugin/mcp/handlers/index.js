'use strict'

// Task 24 / spec §6.3. The MCP surface collapses to two handler modules
// post-cleanup: `entities` (Task 20 — the 4-kind knowledge store) and
// `agents` (daemon status + registration). The old patterns, skills, and
// intelligence handlers were retired alongside the pre-v3.6 pipeline.

const agents = require('./agents')
const entities = require('./entities')

const ALL_TOOLS = [
  ...agents.TOOLS,
  ...entities.TOOLS,
]

const HANDLERS = {}
for (const mod of [agents, entities]) {
  for (const tool of mod.TOOLS) HANDLERS[tool.name] = mod
}

async function dispatch(name, args, db) {
  const handler = HANDLERS[name]
  if (!handler) throw new Error(`Unknown tool: ${name}`)
  const result = await handler.handle(name, args, db)
  if (result === null) throw new Error(`Unknown tool: ${name}`)
  return result
}

module.exports = { ALL_TOOLS, dispatch }
