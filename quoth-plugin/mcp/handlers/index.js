'use strict'

const patterns = require('./patterns')
const skills = require('./skills')
const agents = require('./agents')
const intelligence = require('./intelligence')
const entities = require('./entities')

// Collect all tool definitions. `entities` is the Task 20 replacement for
// `patterns`; both are temporarily registered so the MCP surface keeps
// working during the cutover. Task 24 drops patterns/skills/intelligence.
// Tool names do not overlap today (entities uses quoth_*_entity/entities,
// patterns uses quoth_*_pattern/patterns) so the ordering below is not
// load-bearing — if a future collision appeared, entities would overwrite
// HANDLERS but ALL_TOOLS would still advertise both, which the MCP client
// would see as duplicates. Keep tool names distinct during the cutover.
const ALL_TOOLS = [
  ...patterns.TOOLS,
  ...skills.TOOLS,
  ...agents.TOOLS,
  ...intelligence.TOOLS,
  ...entities.TOOLS,
]

// Build handler dispatch map: toolName -> module
const HANDLERS = {}
for (const mod of [patterns, skills, agents, intelligence, entities]) {
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
