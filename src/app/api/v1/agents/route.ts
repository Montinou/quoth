/**
 * /api/v1/agents
 *   GET  — List agents in the caller's org.
 *   POST — Register a new agent.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { agentRegistry } from '@/db/schema';
import { forbidden } from '@/lib/api/errors';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const registerAgentBody = z.object({
  agentName: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'agent_name must be lowercase alphanumeric with hyphens'),
  displayName: z.string().max(128).optional(),
  instance: z.string().min(1).max(128),
  model: z.string().max(128).optional(),
  role: z
    .enum(['orchestrator', 'specialist', 'curator', 'admin', 'agent'])
    .optional()
    .default('agent'),
  capabilities: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listAgentsQuery = z.object({
  status: z.enum(['active', 'inactive', 'archived']).optional().default('active'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/v1/agents
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listAgentsQuery },
  },
  async (req, ctx) => {
    const db = getDb();
    const { status, limit, offset } = req.validatedQuery as z.infer<typeof listAgentsQuery>;

    const rows = await db
      .select({
        id: agentRegistry.id,
        agentName: agentRegistry.agentName,
        displayName: agentRegistry.displayName,
        instance: agentRegistry.instance,
        model: agentRegistry.model,
        role: agentRegistry.role,
        capabilities: agentRegistry.capabilities,
        status: agentRegistry.status,
        lastSeenAt: agentRegistry.lastSeenAt,
        createdAt: agentRegistry.createdAt,
      })
      .from(agentRegistry)
      .where(and(eq(agentRegistry.orgId, ctx!.orgId), eq(agentRegistry.status, status)))
      .limit(limit)
      .offset(offset);

    return Response.json({ data: rows, limit, offset });
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/agents
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: registerAgentBody },
  },
  async (req, ctx) => {
    if (!['owner', 'admin'].includes(ctx!.role)) {
      throw forbidden('Only admins can register agents.');
    }

    const db = getDb();
    const body = req.validatedBody as z.infer<typeof registerAgentBody>;

    // Generate a signing key for message authentication
    const signingKey = `qsk_${nanoid(32)}`;

    const [agent] = await db
      .insert(agentRegistry)
      .values({
        orgId: ctx!.orgId,
        agentName: body.agentName,
        displayName: body.displayName,
        instance: body.instance,
        model: body.model,
        role: body.role,
        capabilities: body.capabilities ?? {},
        metadata: body.metadata ?? {},
        signingKey,
      })
      .returning();

    // Return signing key only on creation (never exposed again)
    return Response.json(
      {
        data: {
          ...agent,
          signingKey, // one-time reveal
        },
      },
      { status: 201 },
    );
  },
);
