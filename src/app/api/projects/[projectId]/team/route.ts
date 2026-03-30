/**
 * GET /api/projects/{projectId}/team
 *
 * Returns all members of the project joined with their user profiles.
 * Also returns currentUserRole for the authenticated user.
 *
 * Response:
 *   {
 *     members: [{ id, role, created_at, profiles: { id, email, username, full_name, avatar_url } }],
 *     currentUserRole: string | null,
 *   }
 *
 * Note: `username` and `full_name` are mapped from `display_name`; `email` is the user's email.
 */

export const runtime = 'nodejs';

import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getSecureDb } from '@/db/connection';
import { projects, projectMembers, users } from '@/db/schema';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;

  const db = await getSecureDb(ctx.orgId, ctx.userId);

  // Verify the project belongs to the caller's org
  const [project] = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Fetch all members with user profile data
  const rows = await db
    .select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      created_at: projectMembers.createdAt,
      userDbId: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      clerkUserId: users.clerkUserId,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId));

  const members = rows.map((row) => ({
    id: row.userId,
    role: row.role,
    created_at: row.created_at,
    profiles: {
      id: row.userDbId,
      email: row.email,
      username: row.displayName ?? row.email,
      full_name: row.displayName ?? null,
      avatar_url: row.avatarUrl ?? null,
    },
  }));

  // Determine currentUserRole
  let currentUserRole: string | null = null;

  if (!ctx.isAgent && ctx.clerkUserId) {
    const currentRow = rows.find((r) => r.clerkUserId === ctx.clerkUserId);
    currentUserRole = currentRow?.role ?? null;
  }

  return Response.json({ members, currentUserRole });
}
