/**
 * /api/v1/agents/[id]/keys
 *   POST — Generate a new API key for the agent.
 *   GET  — List active (non-revoked) keys for the agent.
 */

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getSecureDb } from '@/db/connection';
import { agentApiKeys, agentRegistry } from '@/db/schema';
import { notFound, forbidden } from '@/lib/api/errors';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createKeyBody = z.object({
  label: z.string().max(128).optional(),
  scopes: z
    .array(z.enum(['read', 'write', 'search', 'admin']))
    .optional()
    .default(['read', 'write']),
  projectIds: z.array(z.string().uuid()).optional(),
  rateLimitRpm: z.number().int().min(1).max(1000).optional().default(60),
  /** Optional expiry in ISO 8601 format */
  expiresAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hash an API key for storage. Uses the Web Crypto API (available in Edge/Node 18+).
 */
async function hashKey(raw: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// POST /api/v1/agents/:id/keys
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 10 },
    validate: { body: createKeyBody },
  },
  async (req, ctx, params) => {
    if (!['owner', 'admin'].includes(ctx!.role)) {
      throw forbidden('Only admins can generate API keys.');
    }

    const db = await getSecureDb(ctx!.orgId, ctx!.userId);
    const agentId = params.id;

    // Verify agent exists and belongs to this org
    const [agent] = await db
      .select({ id: agentRegistry.id })
      .from(agentRegistry)
      .where(and(eq(agentRegistry.id, agentId), eq(agentRegistry.orgId, ctx!.orgId)))
      .limit(1);

    if (!agent) {
      throw notFound(`Agent ${agentId} not found.`);
    }

    const body = req.validatedBody as z.infer<typeof createKeyBody>;

    // Generate raw key with qth_ prefix
    const rawKey = `qth_${nanoid(40)}`;
    const prefix = rawKey.substring(0, 12); // "qth_XXXXXXXX" for display
    const keyHash = await hashKey(rawKey);

    const [key] = await db
      .insert(agentApiKeys)
      .values({
        agentId,
        orgId: ctx!.orgId,
        keyHash,
        keyPrefix: prefix,
        label: body.label,
        scopes: body.scopes,
        projectIds: body.projectIds,
        rateLimitRpm: body.rateLimitRpm,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdBy: ctx!.isAgent ? null : ctx!.userId,
      })
      .returning({
        id: agentApiKeys.id,
        keyPrefix: agentApiKeys.keyPrefix,
        label: agentApiKeys.label,
        scopes: agentApiKeys.scopes,
        rateLimitRpm: agentApiKeys.rateLimitRpm,
        expiresAt: agentApiKeys.expiresAt,
        createdAt: agentApiKeys.createdAt,
      });

    // Raw key is only returned ONCE at creation time
    return Response.json(
      {
        data: {
          ...key,
          rawKey, // one-time reveal
        },
      },
      { status: 201 },
    );
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/agents/:id/keys
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
  },
  async (_req, ctx, params) => {
    const db = await getSecureDb(ctx!.orgId, ctx!.userId);
    const agentId = params.id;

    // Verify agent belongs to this org
    const [agent] = await db
      .select({ id: agentRegistry.id })
      .from(agentRegistry)
      .where(and(eq(agentRegistry.id, agentId), eq(agentRegistry.orgId, ctx!.orgId)))
      .limit(1);

    if (!agent) {
      throw notFound(`Agent ${agentId} not found.`);
    }

    const keys = await db
      .select({
        id: agentApiKeys.id,
        keyPrefix: agentApiKeys.keyPrefix,
        label: agentApiKeys.label,
        scopes: agentApiKeys.scopes,
        rateLimitRpm: agentApiKeys.rateLimitRpm,
        expiresAt: agentApiKeys.expiresAt,
        lastUsedAt: agentApiKeys.lastUsedAt,
        createdAt: agentApiKeys.createdAt,
      })
      .from(agentApiKeys)
      .where(
        and(eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt)),
      );

    return Response.json({ data: keys });
  },
);
