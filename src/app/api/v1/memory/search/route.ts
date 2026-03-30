/**
 * POST /api/v1/memory/search — Semantic search agent memory (agent auth required)
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/api/handler';
import { searchMemory } from '@/lib/memory/service';
import { forbidden } from '@/lib/api/errors';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schema ─────────────────────────────────────────────────────────────

const SearchBodySchema = z.object({
  query: z.string().min(1).max(1024),
  namespace: z.string().max(128).optional(),
  tier: z.enum(['working', 'persistent']).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireAgentAuth(ctx: AuthContext | null): { agentId: string } {
  if (!ctx || !ctx.isAgent || !ctx.agentId) {
    throw forbidden('This endpoint requires agent authentication (qth_ API key).');
  }
  return { agentId: ctx.agentId };
}

// ─── POST /api/v1/memory/search ─────────────────────────────────────────────

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { body: SearchBodySchema },
  },
  async (req, ctx) => {
    const { agentId } = requireAgentAuth(ctx);
    const body = req.validatedBody as z.infer<typeof SearchBodySchema>;

    const results = await searchMemory(agentId, ctx!.orgId, {
      query: body.query,
      namespace: body.namespace,
      tier: body.tier,
      limit: body.limit,
      threshold: body.threshold,
    });

    return NextResponse.json({
      count: results.length,
      query: body.query,
      results,
    });
  },
);
