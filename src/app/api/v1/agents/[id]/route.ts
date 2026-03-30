/**
 * /api/v1/agents/[id]
 *   GET   — Retrieve agent details.
 *   PATCH — Update agent fields.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getSecureDb } from '@/db/connection';
import { agentRegistry } from '@/db/schema';
import { notFound, forbidden } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const updateAgentBody = z.object({
  displayName: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  role: z.enum(['orchestrator', 'specialist', 'curator', 'admin', 'agent']).optional(),
  capabilities: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
  },
  async (_req, ctx, params) => {
    const db = await getSecureDb(ctx!.orgId, ctx!.userId);

    const [agent] = await db
      .select({
        id: agentRegistry.id,
        agentName: agentRegistry.agentName,
        displayName: agentRegistry.displayName,
        instance: agentRegistry.instance,
        model: agentRegistry.model,
        role: agentRegistry.role,
        capabilities: agentRegistry.capabilities,
        metadata: agentRegistry.metadata,
        status: agentRegistry.status,
        lastSeenAt: agentRegistry.lastSeenAt,
        createdAt: agentRegistry.createdAt,
        updatedAt: agentRegistry.updatedAt,
      })
      .from(agentRegistry)
      .where(and(eq(agentRegistry.id, params.id), eq(agentRegistry.orgId, ctx!.orgId)))
      .limit(1);

    if (!agent) {
      throw notFound(`Agent ${params.id} not found.`);
    }

    return Response.json({ data: agent });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/v1/agents/:id
// ---------------------------------------------------------------------------

export const PATCH = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: updateAgentBody },
  },
  async (req, ctx, params) => {
    if (!['owner', 'admin'].includes(ctx!.role)) {
      throw forbidden('Only admins can update agents.');
    }

    const db = await getSecureDb(ctx!.orgId, ctx!.userId);
    const body = req.validatedBody as z.infer<typeof updateAgentBody>;

    // Build update set from provided fields only
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) updateSet.displayName = body.displayName;
    if (body.model !== undefined) updateSet.model = body.model;
    if (body.role !== undefined) updateSet.role = body.role;
    if (body.capabilities !== undefined) updateSet.capabilities = body.capabilities;
    if (body.metadata !== undefined) updateSet.metadata = body.metadata;
    if (body.status !== undefined) updateSet.status = body.status;

    const [updated] = await db
      .update(agentRegistry)
      .set(updateSet)
      .where(and(eq(agentRegistry.id, params.id), eq(agentRegistry.orgId, ctx!.orgId)))
      .returning();

    if (!updated) {
      throw notFound(`Agent ${params.id} not found.`);
    }

    return Response.json({ data: updated });
  },
);
