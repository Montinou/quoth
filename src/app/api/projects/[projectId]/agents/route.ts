/**
 * GET    /api/projects/:projectId/agents — List agents assigned to a project
 * POST   /api/projects/:projectId/agents — Assign an agent to a project
 * DELETE /api/projects/:projectId/agents — Remove an agent from a project
 *
 * Body (POST/DELETE): { agentId: string, role?: 'owner' | 'contributor' | 'readonly' }
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

export const GET = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 60 } },
  async (_req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { getDb } = await import('@/db/connection');
    const db = getDb();

    const clerkId = ctx.clerkUserId ?? ctx.userId;
    const userRow = await db.execute<{ id: string; default_org_id: string }>(sql`
      SELECT id, default_org_id FROM public.users WHERE clerk_user_id = ${clerkId} LIMIT 1
    `);
    const user = userRow.rows[0] as { id: string; default_org_id: string } | undefined;
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

    const orgId = ctx.orgId || user.default_org_id;

    // Verify the project belongs to this org
    const projectCheck = await db.execute(sql`
      SELECT 1 FROM public.projects WHERE id = ${projectId}::uuid AND org_id = ${orgId}::uuid LIMIT 1
    `);
    if (!projectCheck.rows.length) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const rows = await db.execute<{
      agent_id: string;
      role: string;
      assigned_at: string;
      agent_name: string;
      display_name: string | null;
      instance: string;
      status: string;
    }>(sql`
      SELECT
        ap.agent_id,
        ap.role,
        ap.assigned_at,
        r.agent_name,
        r.display_name,
        r.instance,
        r.status
      FROM agents.agent_projects ap
      JOIN agents.registry r ON r.id = ap.agent_id
      WHERE ap.project_id = ${projectId}::uuid
      ORDER BY ap.assigned_at DESC
    `);

    return Response.json({ agents: rows.rows });
  },
);

const AssignBody = z.object({
  agentId: z.string().uuid(),
  role: z.enum(['owner', 'contributor', 'readonly']).default('contributor'),
});

const UnassignBody = z.object({
  agentId: z.string().uuid(),
});

export const POST = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 30 }, validate: { body: AssignBody } },
  async (req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { agentId, role } = req.validatedBody as z.infer<typeof AssignBody>;

    const { getDb } = await import('@/db/connection');
    const db = getDb();

    // Look up the internal user UUID from Clerk ID
    const clerkId = ctx.clerkUserId ?? ctx.userId;

    let user: { id: string; default_org_id: string } | undefined;
    try {
      const userRow = await db.execute<{ id: string; default_org_id: string }>(sql`
        SELECT id, default_org_id FROM public.users WHERE clerk_user_id = ${clerkId} LIMIT 1
      `);
      user = userRow.rows[0] as { id: string; default_org_id: string } | undefined;
    } catch (err) {
      console.error('[assign-agent] User lookup failed:', err);
      return Response.json({ error: 'User lookup failed', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
    }

    if (!user) return Response.json({ error: 'User not found', clerkId }, { status: 404 });

    const orgId = ctx.orgId || user.default_org_id;
    if (!orgId) return Response.json({ error: 'No organization context' }, { status: 400 });

    // Verify agent exists in the same org
    try {
      const agentCheck = await db.execute(sql`
        SELECT 1 FROM agents.registry
        WHERE id = ${agentId}::uuid AND org_id = ${orgId}::uuid
      `);
      if (!agentCheck.rows.length) {
        return Response.json({ error: 'Agent not found in organization', agentId, orgId }, { status: 404 });
      }
    } catch (err) {
      console.error('[assign-agent] Agent check failed:', err);
      return Response.json({ error: 'Agent lookup failed', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
    }

    // Upsert assignment
    try {
      await db.execute(sql`
        INSERT INTO agents.agent_projects (agent_id, project_id, role, assigned_by)
        VALUES (${agentId}::uuid, ${projectId}::uuid, ${role}, ${user.id}::uuid)
        ON CONFLICT (agent_id, project_id) DO UPDATE SET
          role = EXCLUDED.role,
          assigned_at = now(),
          assigned_by = EXCLUDED.assigned_by
      `);
    } catch (err) {
      console.error('[assign-agent] Upsert failed:', err);
      return Response.json({ error: 'Assignment failed', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
    }

    return Response.json({ ok: true, agentId, projectId, role });
  },
);

export const DELETE = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 30 }, validate: { body: UnassignBody } },
  async (req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { agentId } = req.validatedBody as z.infer<typeof UnassignBody>;

    const { getDb } = await import('@/db/connection');
    const db = getDb();

    const result = await db.execute(sql`
      DELETE FROM agents.agent_projects
      WHERE agent_id = ${agentId}::uuid AND project_id = ${projectId}::uuid
    `);

    const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (rowCount === 0) {
      return Response.json({ error: 'Assignment not found' }, { status: 404 });
    }

    return Response.json({ ok: true });
  },
);
