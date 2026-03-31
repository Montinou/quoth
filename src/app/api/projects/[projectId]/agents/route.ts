/**
 * POST /api/projects/:projectId/agents — Assign an agent to a project
 * DELETE /api/projects/:projectId/agents — Remove an agent from a project
 *
 * Body: { agentId: string, role?: 'owner' | 'contributor' | 'readonly' }
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

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
    const userRow = await db.execute<{ id: string; default_org_id: string }>(sql`
      SELECT id, default_org_id FROM public.users WHERE clerk_user_id = ${clerkId} LIMIT 1
    `);
    const user = userRow.rows[0] as { id: string; default_org_id: string } | undefined;
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

    const orgId = ctx.orgId || user.default_org_id;

    // Verify agent exists in the same org
    const agentCheck = await db.execute(sql`
      SELECT 1 FROM agents.registry
      WHERE id = ${agentId}::uuid AND org_id = ${orgId}::uuid
    `);
    if (!agentCheck.rows.length) {
      return Response.json({ error: 'Agent not found in organization' }, { status: 404 });
    }

    // Upsert assignment
    await db.execute(sql`
      INSERT INTO agents.agent_projects (agent_id, project_id, role, assigned_by)
      VALUES (${agentId}::uuid, ${projectId}::uuid, ${role}, ${user.id}::uuid)
      ON CONFLICT (agent_id, project_id) DO UPDATE SET
        role = EXCLUDED.role,
        assigned_at = now(),
        assigned_by = EXCLUDED.assigned_by
    `);

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
