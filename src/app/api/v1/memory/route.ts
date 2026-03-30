/**
 * POST /api/v1/memory — Store a memory (agent auth required)
 * GET  /api/v1/memory — List memories (agent auth required)
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/api/handler';
import { storeMemory, listMemory } from '@/lib/memory/service';
import { forbidden } from '@/lib/api/errors';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const StoreBodySchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
  namespace: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  projectId: z.string().uuid().optional(),
});

const ListQuerySchema = z.object({
  namespace: z.string().max(128).optional(),
  tier: z.enum(['working', 'persistent']).optional(),
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default('25'),
  offset: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(0))
    .optional()
    .default('0'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireAgentAuth(ctx: AuthContext | null): { agentId: string; orgId: string } {
  if (!ctx || !ctx.isAgent || !ctx.agentId) {
    throw forbidden('This endpoint requires agent authentication (qth_ API key).');
  }
  return { agentId: ctx.agentId, orgId: ctx.orgId };
}

// ─── POST /api/v1/memory ────────────────────────────────────────────────────

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: StoreBodySchema },
  },
  async (req, ctx) => {
    const { agentId, orgId } = requireAgentAuth(ctx);
    const body = req.validatedBody as z.infer<typeof StoreBodySchema>;

    // Ensure value is serialized to string for the TEXT column
    const valueStr = typeof body.value === 'string'
      ? body.value
      : JSON.stringify(body.value);

    const result = await storeMemory(agentId, orgId, {
      key: body.key,
      value: valueStr,
      namespace: body.namespace,
      tags: body.tags,
      metadata: body.metadata,
      ttlSeconds: body.ttlSeconds,
      projectId: body.projectId ?? (ctx!.projectId || undefined),
    });

    return NextResponse.json(
      {
        stored: true,
        ...result,
      },
      { status: 201 },
    );
  },
);

// ─── GET /api/v1/memory ─────────────────────────────────────────────────────

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { query: ListQuerySchema },
  },
  async (req, ctx) => {
    const { agentId } = requireAgentAuth(ctx);
    const query = req.validatedQuery as z.infer<typeof ListQuerySchema>;

    const limit = typeof query.limit === 'string' ? Number(query.limit) : query.limit;
    const offset = typeof query.offset === 'string' ? Number(query.offset) : query.offset;

    const results = await listMemory(agentId, {
      namespace: query.namespace,
      tier: query.tier,
      limit,
      offset,
    });

    return NextResponse.json({
      count: results.length,
      limit,
      offset,
      memories: results,
    });
  },
);
