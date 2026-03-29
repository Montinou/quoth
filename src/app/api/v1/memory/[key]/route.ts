/**
 * GET    /api/v1/memory/:key — Get a specific memory (agent auth required)
 * DELETE /api/v1/memory/:key — Forget a specific memory (agent auth required)
 *
 * Query param: ?namespace=xxx (defaults to "default")
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/api/handler';
import { getMemory, forgetMemory } from '@/lib/memory/service';
import { forbidden, notFound } from '@/lib/api/errors';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schema ─────────────────────────────────────────────────────────────

const KeyQuerySchema = z.object({
  namespace: z.string().max(128).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireAgentAuth(ctx: AuthContext | null): { agentId: string } {
  if (!ctx || !ctx.isAgent || !ctx.agentId) {
    throw forbidden('This endpoint requires agent authentication (qth_ API key).');
  }
  return { agentId: ctx.agentId };
}

// ─── GET /api/v1/memory/:key ────────────────────────────────────────────────

export const GET = createApiHandler(
  {
    auth: 'required',
    validate: { query: KeyQuerySchema },
  },
  async (req, ctx, params) => {
    const { agentId } = requireAgentAuth(ctx);
    const query = req.validatedQuery as z.infer<typeof KeyQuerySchema>;
    const key = params.key;

    if (!key) {
      throw notFound('Memory key is required.');
    }

    const namespace = query.namespace ?? 'default';
    const memory = await getMemory(agentId, namespace, key);

    if (!memory) {
      throw notFound(`Memory with key "${key}" not found.`);
    }

    return NextResponse.json(memory);
  },
);

// ─── DELETE /api/v1/memory/:key ─────────────────────────────────────────────

export const DELETE = createApiHandler(
  {
    auth: 'required',
    validate: { query: KeyQuerySchema },
  },
  async (req, ctx, params) => {
    const { agentId } = requireAgentAuth(ctx);
    const query = req.validatedQuery as z.infer<typeof KeyQuerySchema>;
    const key = params.key;

    if (!key) {
      throw notFound('Memory key is required.');
    }

    const namespace = query.namespace ?? 'default';
    const deleted = await forgetMemory(agentId, namespace, key);

    return NextResponse.json({
      forgotten: deleted,
      key,
      namespace,
    });
  },
);
