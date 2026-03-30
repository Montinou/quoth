/**
 * /api/proposals
 *   GET — List proposals, optionally filtered by status.
 */

export const runtime = 'nodejs';

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { proposals } from '@/db/schema';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listProposalsQuery = z.object({
  status: z
    .enum(['pending', 'approved', 'rejected', 'applied'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/proposals
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listProposalsQuery },
  },
  async (_req, ctx, _params) => {
    const query = _req.validatedQuery as z.infer<typeof listProposalsQuery>;
    const db = getDb();

    const conditions = [eq(proposals.projectId, ctx!.projectId)];
    if (query.status) {
      conditions.push(eq(proposals.status, query.status));
    }

    const rows = await db
      .select()
      .from(proposals)
      .where(and(...conditions))
      .limit(query.limit)
      .offset(query.offset);

    return Response.json({ proposals: rows });
  },
);
