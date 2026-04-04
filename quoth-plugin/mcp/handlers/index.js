'use strict'

const patterns = require('./patterns')
const skills = require('./skills')
const agents = require('./agents')
const intelligence = require('./intelligence')

// Collect all tool definitions
const ALL_TOOLS = [
  ...patterns.TOOLS,
  ...skills.TOOLS,
  ...agents.TOOLS,
  ...intelligence.TOOLS,
]

// Build handler dispatch map: toolName -> module
const HANDLERS = {}
for (const mod of [patterns, skills, agents, intelligence]) {
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
