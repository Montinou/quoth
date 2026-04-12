'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories')

const TOOLS = [
  {
    name: 'quoth_daemon_status',
    description: 'Check if the Quoth learning daemon is running',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'quoth_agent_register',
    description: 'Register or update an agent in the Quoth coordination layer.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Unique agent identifier' },
        name: { type: 'string', description: 'Human-readable name' },
        type: { type: 'string', enum: ['claude-code', 'openclaw', 'daemon', 'worker'] },
        project: { type: 'string' },
        platform: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' }
      },
      required: ['agentId', 'name', 'type']
    }
  },
  {
    name: 'quoth_agent_heartbeat',
    description: 'Send heartbeat to keep agent status as online.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        status: { type: 'string', enum: ['online', 'busy', 'idle'] }
      },
      required: ['agentId']
    }
  },
  {
    name: 'quoth_agent_list',
    description: 'List registered agents, optionally filtered by project, type, or status',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string', enum: ['online', 'offline', 'busy', 'idle'] },
        limit: { type: 'number', default: 20 }
      }
    }
  },
  {
    name: 'quoth_assign_task',
    description: 'Assign a task to an agent via the event system.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Target agent ID' },
        task: { type: 'string', description: 'Task description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        metadata: { type: 'object' }
      },
      required: ['agentId', 'task']
    }
  }
]

async function handle(name, args, db) {
  switch (name) {
    case 'quoth_daemon_status': {
      const pidFile = path.join(QUOTH_HOME, 'daemon.pid')
      if (!fs.existsSync(pidFile)) return { running: false }
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim())
      try {
        process.kill(pid, 0)
        const logFile = path.join(QUOTH_HOME, 'daemon.log')
        const lastLog = fs.existsSync(logFile)
          ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-3).join('\n')
          : 'no log'
        let costSummary = null
        try {
          costSummary = {
            today: db.getCostSummary('today'),
            week: db.getCostSummary('week'),
            all_time: db.getCostSummary(),
          }
        } catch {}
        return { running: true, pid, lastLog, costSummary }
      } catch {
        return { running: false, stalePid: pid }
      }
    }
    case 'quoth_agent_register': {
      db.registerAgent({
        agentId: args.agentId, name: args.name, type: args.type,
        project: args.project, platform: args.platform,
        capabilities: args.capabilities, metadata: args.metadata
      })
      db.emitEvent('agent.registered', args.agentId, args.project, {
        name: args.name, type: args.type, platform: args.platform
      })
      return { registered: true, agentId: args.agentId }
    }
    case 'quoth_agent_heartbeat': {
      db.heartbeat(args.agentId, args.status)
      return { ok: true, agentId: args.agentId, timestamp: Date.now() }
    }
    case 'quoth_agent_list': {
      const agents = db.listAgents({
        project: args.project, type: args.type,
        status: args.status, limit: args.limit || 20
      })
      return { count: agents.length, agents }
    }
    case 'quoth_assign_task': {
      const targetAgent = db.listAgents({ limit: 100 }).find(a => a.agent_id === args.agentId)
      const assignResult = db.emitEvent('task.assigned', args.agentId, targetAgent?.project, {
        task: args.task, priority: args.priority || 'medium',
        assignedBy: 'mcp', ...(args.metadata || {})
      })
      return { assigned: true, eventId: assignResult.lastInsertRowid, agentId: args.agentId, task: args.task }
    }
    default:
      return null
  }
}

module.exports = { TOOLS, handle }
