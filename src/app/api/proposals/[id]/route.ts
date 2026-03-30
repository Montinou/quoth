/**
 * /api/proposals/[id]
 *   GET — Retrieve a single proposal by UUID.
 */

export const runtime = 'nodejs';

import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { proposals } from '@/db/schema';
import { notFound } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// GET /api/proposals/:id
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
  },
  async (_req, ctx, params) => {
    const db = getDb();

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.id, params.id),
          eq(proposals.projectId, ctx!.projectId),
        ),
      )
      .limit(1);

    if (!proposal) {
      throw notFound(`Proposal ${params.id} not found.`);
    }

    return Response.json({ proposal });
  },
);
