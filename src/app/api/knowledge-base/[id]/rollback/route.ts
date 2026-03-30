/**
 * POST /api/knowledge-base/{id}/rollback
 *
 * Stub endpoint — version history not yet implemented.
 * Returns 501 Not Implemented.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/clerk';

export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Auth check — reject unauthenticated callers even for stubs
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    { success: false, error: 'Version history not yet implemented' },
    { status: 501 },
  );
}
