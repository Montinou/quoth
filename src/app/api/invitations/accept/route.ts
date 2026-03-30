/**
 * POST /api/invitations/accept
 *
 * Accept a project invitation by token.
 * Body: { token: string }
 * Response: { success: boolean, project: { slug: string } }
 *
 * Note: There is no invitations table in the current schema.
 * Returns 501 Not Implemented.
 */

export const runtime = 'nodejs';

import { getAuthContext } from '@/lib/auth/clerk';

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.token || typeof body.token !== 'string') {
    return Response.json({ error: 'Missing required field: token' }, { status: 400 });
  }

  // Invitations table not yet implemented
  return Response.json(
    { error: 'Invitations not yet implemented' },
    { status: 501 },
  );
}
