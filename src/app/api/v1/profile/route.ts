/**
 * GET /api/v1/profile — Return current user's DB profile
 * Uses Clerk auth to identify the user, fetches from public.users table.
 */

import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/db/connection';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  const row = result[0];
  if (!row) {
    return Response.json({ error: 'Profile not found' }, { status: 404 });
  }

  return Response.json(
    {
      id: row.id,
      clerkUserId: row.clerkUserId,
      email: row.email,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      defaultOrgId: row.defaultOrgId,
      defaultProjectId: row.defaultProjectId,
    },
    { headers: { 'Cache-Control': 'private, s-maxage=300, stale-while-revalidate=600' } },
  );
}
