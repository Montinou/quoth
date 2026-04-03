/**
 * POST /api/v1/trajectories/ingest
 * HTTP ingestion endpoint for trajectory entries from OpenClaw agents,
 * external systems, and batch imports.
 * Agent API key only -- Clerk JWT rejected with 403.
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApiHandler } from '@/lib/api/handler';
import { forbidden } from '@/lib/api/errors';

const QUOTH_HOME = process.env.QUOTH_HOME || path.join(os.homedir(), '.quoth');
const TRAJECTORIES_DIR = path.join(QUOTH_HOME, 'trajectories');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const trajectoryEntry = z.object({
  event: z.string().default('tool_use'),
  agent: z.string().min(1).max(128),
  project: z.string().max(128).optional().default('unknown'),
  session: z.string().max(256).optional(),
  task: z.string().min(1).max(1024),
  outcome: z.enum(['success', 'failure']),
  pattern_used: z.string().max(256).nullable().optional(),
  source: z
    .enum(['claude-code', 'openclaw-telegram', 'openclaw-whatsapp', 'api'])
    .optional()
    .default('api'),
});

const ingestBody = z.object({
  entries: z.array(trajectoryEntry).min(1).max(500),
});

// ---------------------------------------------------------------------------
// POST /api/v1/trajectories/ingest
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: ingestBody },
  },
  async (req, ctx) => {
    // Agents only -- block human Clerk sessions
    if (!ctx!.isAgent) {
      throw forbidden('Trajectory ingestion is only available to agent API keys.');
    }

    const { entries } = req.validatedBody as z.infer<typeof ingestBody>;

    // Ensure trajectories directory exists
    if (!fs.existsSync(TRAJECTORIES_DIR)) {
      fs.mkdirSync(TRAJECTORIES_DIR, { recursive: true });
    }

    // Write all entries to date-stamped trajectory file
    const date = new Date().toISOString().slice(0, 10);
    const source = entries[0]?.source || 'api';
    const trajFile = path.join(TRAJECTORIES_DIR, `remote-${source}-${date}.jsonl`);

    const lines = entries
      .map((e) =>
        JSON.stringify({
          event: e.event || 'tool_use',
          agent: e.agent,
          project: e.project || 'unknown',
          session: e.session || `remote-${Date.now()}`,
          task: e.task,
          outcome: e.outcome,
          pattern_used: e.pattern_used || null,
          source: e.source || 'api',
          timestamp: Date.now(),
        }),
      )
      .join('\n') + '\n';

    fs.appendFileSync(trajFile, lines);

    // Signal daemon to process new entries
    let daemonSignaled = false;
    const pidFile = path.join(QUOTH_HOME, 'daemon.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        process.kill(pid, 'SIGUSR1');
        daemonSignaled = true;
      } catch {
        // Daemon not running or stale PID -- non-fatal
      }
    }

    return Response.json({
      ingested: entries.length,
      daemonSignaled,
      trajectoryFile: path.basename(trajFile),
    });
  },
);
