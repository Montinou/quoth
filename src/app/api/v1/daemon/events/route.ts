/**
 * /api/v1/daemon/events
 *   GET — Query events from the local Quoth daemon SQLite DB.
 *
 * Auth: X-Quoth-Key header or Bearer token matching QUOTH_API_KEY env var.
 * Query params: eventType, agentId, project, since (timestamp ms), limit.
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
// GET /api/v1/daemon/events — query events
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authError = authCheck(request)
  if (authError) return authError

  try {
    const db = getLocalDb()
    const url = new URL(request.url)
    const since = url.searchParams.get('since')

    const events = db.getEvents({
      eventType: url.searchParams.get('eventType') || undefined,
      agentId: url.searchParams.get('agentId') || undefined,
      project: url.searchParams.get('project') || undefined,
      since: since ? parseInt(since) : undefined,
      limit: parseInt(url.searchParams.get('limit') || '50'),
    })
    db.close()

    return NextResponse.json({ count: events.length, events })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
