'use strict'

const { openDb } = require('../../daemon/db.js')
const { routeTask } = require('../lib/routing.js')

const TOOLS = [
  {
    name: 'quoth_log_outcome',
    description: 'Log a positive or negative outcome for a knowledge entity, updating its Bayesian confidence (Beta(alpha, beta) posterior).',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'ID of the knowledge entity' },
        outcome: { type: 'string', enum: ['positive', 'negative'], description: 'Whether the entity helped or hurt' },
        context: { type: 'string', description: 'Optional context about the outcome' },
      },
      required: ['entityId', 'outcome'],
    },
  },
  {
    name: 'quoth_route_task',
    description: 'Route a task description to the optimal agent type using keyword matching against 8 canonical agent roles.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description to route' },
      },
      required: ['task'],
    },
  },
]

async function handle(name, args) {
  switch (name) {
    case 'quoth_log_outcome': {
      const db = openDb()
      const entity = db.prepare(
        'SELECT id, alpha, beta FROM knowledge_entities WHERE id = ? AND status = ?'
      ).get(args.entityId, 'active')
      if (!entity) return { error: 'Entity not found or archived' }

      const isPositive = args.outcome === 'positive'
      const newAlpha = entity.alpha + (isPositive ? 1 : 0)
      const newBeta = entity.beta + (isPositive ? 0 : 1)
      const newConfidence = newAlpha / (newAlpha + newBeta)

      db.prepare(`
        UPDATE knowledge_entities
        SET alpha = ?, beta = ?, confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(newAlpha, newBeta, newConfidence, Date.now(), args.entityId)

      return {
        entityId: args.entityId,
        outcome: args.outcome,
        alpha: newAlpha,
        beta: newBeta,
        confidence: Math.round(newConfidence * 1000) / 1000,
      }
    }
    case 'quoth_route_task': {
      const result = routeTask(args.task)
      return result
    }
    default:
      return null
  }
}

module.exports = { TOOLS, handle }
