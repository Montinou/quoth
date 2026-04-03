/**
 * /api/v1/daemon/agents
 *   GET  — List agents from the local Quoth daemon SQLite DB.
 *   POST — Register an agent or send heartbeat via the local daemon.
 *
 * Auth: X-Quoth-Key header or Bearer token matching QUOTH_API_KEY env var.
 * This route talks to the local ~/.quoth/memory.db (not the SaaS Postgres DB).
 */

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import os from 'os'

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth')
const DB_PATH = path.join(QUOTH_HOME, 'memory.db')
const QUOTH_API_KEY = process.env.QUOTH_API_KEY

function authCheck(request: NextRequest) {
  const apiKey =
    request.headers.get('X-Quoth-Key') ||
    request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!QUOTH_API_KEY || apiKey !== QUOTH_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function getLocalDb() {
  const DB_MODULE =
    process.env.QUOTH_DB_MODULE ||
    path.join(process.cwd(), 'quoth-plugin/daemon/db.js')
  // Dynamic require — bypass webpack static analysis
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = eval('require')(DB_MODULE)
  return mod.createDb(DB_PATH)
}

// ---------------------------------------------------------------------------
// POST /api/v1/daemon/agents — register or heartbeat
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authError = authCheck(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const db = getLocalDb()

    if (body.action === 'heartbeat') {
      if (!body.agentId) {
        db.close()
        return NextResponse.json({ error: 'agentId required' }, { status: 400 })
      }
      db.heartbeat(body.agentId, body.status)
      db.close()
      return NextResponse.json({ ok: true, timestamp: Date.now() })
    }

    // Register
    if (!body.agentId || !body.name || !body.type) {
      db.close()
      return NextResponse.json(
        { error: 'agentId, name, type required' },
        { status: 400 },
      )
    }

    db.registerAgent(body)
    db.emitEvent('agent.registered', body.agentId, body.project, {
      name: body.name,
      type: body.type,
      platform: body.platform,
      source: 'http-api',
    })
    db.close()

    return NextResponse.json({ registered: true, agentId: body.agentId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/daemon/agents — list agents
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authError = authCheck(request)
  if (authError) return authError

  try {
    const db = getLocalDb()
    const url = new URL(request.url)
    const agents = db.listAgents({
      project: url.searchParams.get('project') || undefined,
      type: url.searchParams.get('type') || undefined,
      status: url.searchParams.get('status') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '20'),
    })
    db.close()

    return NextResponse.json({ count: agents.length, agents })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
