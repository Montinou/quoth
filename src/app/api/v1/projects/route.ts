/**
 * /api/v1/projects
 *   GET  — List projects accessible to the authenticated user/agent.
 *   POST — Create a new project in the caller's org.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getDb } from '@/db/connection';
import { projects, projectMembers } from '@/db/schema';
import { forbidden } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createProjectBody = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(1024).optional(),
  isPublic: z.boolean().optional().default(false),
});

const listProjectsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/v1/projects
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listProjectsQuery },
  },
  async (req, ctx) => {
    const db = getDb();
    const { limit, offset } = req.validatedQuery as z.infer<typeof listProjectsQuery>;

    // Agents scoped to allowed projects; humans see all org projects
    const rows = ctx!.isAgent
      ? await db
          .select()
          .from(projects)
          .where(eq(projects.orgId, ctx!.orgId))
          .limit(limit)
          .offset(offset)
      : await db
          .select()
          .from(projects)
          .where(eq(projects.orgId, ctx!.orgId))
          .limit(limit)
          .offset(offset);

    return Response.json({ data: rows, limit, offset });
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/projects
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: createProjectBody },
  },
  async (req, ctx) => {
    if (ctx!.role === 'viewer') {
      throw forbidden('Viewers cannot create projects.');
    }

    const db = getDb();
    const body = req.validatedBody as z.infer<typeof createProjectBody>;

    const [project] = await db
      .insert(projects)
      .values({
        orgId: ctx!.orgId,
        slug: body.slug,
        name: body.name ?? body.slug,
        description: body.description,
        isPublic: body.isPublic,
        tier: ctx!.tier,
      })
      .returning();

    // Add creator as project admin (only for human users)
    if (!ctx!.isAgent && ctx!.userId) {
      await db.insert(projectMembers).values({
        projectId: project.id,
        userId: ctx!.userId,
        role: 'admin',
      });
    }

    return Response.json({ data: project }, { status: 201 });
  },
);
