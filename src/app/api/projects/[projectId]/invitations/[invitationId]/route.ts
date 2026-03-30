/**
 * DELETE /api/projects/{projectId}/invitations/{invitationId} — Cancel invitation
 *
 * Note: There is no invitations table in the current schema.
 * Returns 501 Not Implemented.
 */

export const runtime = 'nodejs';

import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { projects } from '@/db/schema';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; invitationId: string }> },
): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const db = getDb();

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
