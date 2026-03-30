/**
 * PATCH /api/projects/{projectId}/team/{memberId}  — Update member role
 * DELETE /api/projects/{projectId}/team/{memberId} — Remove member
 *
 * Only project admins may update or remove members.
 */

export const runtime = 'nodejs';

import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { projects, projectMembers, users } from '@/db/schema';

async function getCallerDbUserId(clerkUserId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// PATCH — update member role
// ---------------------------------------------------------------------------

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; memberId: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, memberId } = await params;
  const db = getDb();

  // Verify project belongs to caller's org
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Only admins may update roles
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    // Check project-level role for human users
    if (!ctx.isAgent && ctx.clerkUserId) {
      const callerDbId = await getCallerDbUserId(ctx.clerkUserId);
      if (callerDbId) {
        const [callerMembership] = await db
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, callerDbId),
            ),
          )
          .limit(1);

        if (callerMembership?.role !== 'admin') {
          return Response.json({ error: 'Forbidden: admin role required' }, { status: 403 });
        }
      } else {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { role } = body;

  if (!role || !['admin', 'editor', 'viewer'].includes(role)) {
    return Response.json(
      { error: 'Invalid role. Must be one of: admin, editor, viewer' },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(projectMembers)
    .set({ role })
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, memberId),
      ),
    )
    .returning();

  if (!updated) {
    return Response.json({ error: 'Member not found' }, { status: 404 });
  }

  return Response.json({ member: { id: memberId, role: updated.role } });
}

// ---------------------------------------------------------------------------
// DELETE — remove member
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; memberId: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, memberId } = await params;
  const db = getDb();

  // Verify project belongs to caller's org
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Only admins may remove members
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    if (!ctx.isAgent && ctx.clerkUserId) {
      const callerDbId = await getCallerDbUserId(ctx.clerkUserId);
      if (callerDbId) {
        const [callerMembership] = await db
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, callerDbId),
            ),
          )
          .limit(1);

        if (callerMembership?.role !== 'admin') {
          return Response.json({ error: 'Forbidden: admin role required' }, { status: 403 });
        }
      } else {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const [deleted] = await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, memberId),
      ),
    )
    .returning();

  if (!deleted) {
    return Response.json({ error: 'Member not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
