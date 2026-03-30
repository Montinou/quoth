/**
 * GET /api/projects/by-slug/{slug}
 *
 * Resolves a project by slug, returning the project ID and the
 * authenticated user's role in that project.
 *
 * Response: { project: { id, slug, userRole } }
 */


import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getSecureDb } from '@/db/connection';
import { projects, projectMembers, users } from '@/db/schema';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  if (!slug) {
    return Response.json({ error: 'Missing slug' }, { status: 400 });
  }

  const db = await getSecureDb(ctx.orgId, ctx.userId);

  // Resolve the project by slug within the user's org
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Determine user role — agents skip the users lookup
  let userRole: string | null = null;

  if (!ctx.isAgent && ctx.clerkUserId) {
    const [dbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, ctx.clerkUserId))
      .limit(1);

    if (dbUser) {
      const [membership] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, project.id),
            eq(projectMembers.userId, dbUser.id),
          ),
        )
        .limit(1);

      userRole = membership?.role ?? null;
    }
  }

  return Response.json({ project: { id: project.id, slug: project.slug, userRole } });
}
