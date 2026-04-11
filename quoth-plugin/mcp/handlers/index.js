'use strict'

const patterns = require('./patterns')
const skills = require('./skills')
const agents = require('./agents')
const intelligence = require('./intelligence')
const entities = require('./entities')

// Collect all tool definitions. `entities` is the Task 20 replacement for
// `patterns`; both are temporarily registered so the MCP surface keeps
// working during the cutover. Task 24 drops patterns/skills/intelligence.
// If entities and patterns advertise overlapping tool names the entities
// module wins (it's registered last and overwrites HANDLERS).
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
