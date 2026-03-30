/**
 * GET  /api/projects/{projectId}/invitations — List pending invitations
 * POST /api/projects/{projectId}/invitations — Send an invitation
 *
 * Note: There is no invitations table in the current schema.
 * GET returns an empty array; POST returns 501 Not Implemented.
 */


import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getSecureDb } from '@/db/connection';
import { projects } from '@/db/schema';

// ---------------------------------------------------------------------------
// GET — list pending invitations
// ---------------------------------------------------------------------------

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

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // No invitations table exists yet — return empty list
  return Response.json({ invitations: [] });
}

// ---------------------------------------------------------------------------
// POST — send an invitation
// ---------------------------------------------------------------------------

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const db = await getSecureDb(ctx.orgId, ctx.userId);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)))
    .limit(1);

  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  // Invitations table not yet implemented
  return Response.json(
    { error: 'Invitations not yet implemented' },
    { status: 501 },
  );
}
