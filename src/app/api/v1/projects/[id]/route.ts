/**
 * /api/v1/projects/[id]
 *   GET — Retrieve a single project by UUID.
 */

import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { projects } from '@/db/schema';
import { notFound } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// GET /api/v1/projects/:id
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
  },
  async (_req, ctx, params) => {
    const db = getDb();

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, params.id), eq(projects.orgId, ctx!.orgId)))
      .limit(1);

    if (!project) {
      throw notFound(`Project ${params.id} not found.`);
    }

    return Response.json({ data: project });
  },
);
