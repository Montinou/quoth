/**
 * GET /api/v1/generations/[id]
 * QUOTH-04: Addressable URL for individual AI generation records.
 *
 * Returns the full generation record including model, prompt, result,
 * token usage, estimated cost, and status.
 *
 * Requires authentication via Clerk session or agent API key (H-06).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGeneration } from '@/lib/generations/tracker';
import { getAuthContext } from '@/lib/auth/clerk';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // H-06: Require authentication
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const { id } = await params;

  if (!id || typeof id !== 'string' || id.length < 10) {
    return NextResponse.json(
      { error: 'Invalid generation ID' },
      { status: 400 },
    );
  }

  const generation = await getGeneration(id);

  if (!generation) {
    return NextResponse.json(
      { error: 'Generation not found' },
      { status: 404 },
    );
  }

  // Verify the requesting user/agent belongs to the same project
  if (authCtx.projectId && generation.projectId && authCtx.projectId !== generation.projectId) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 },
    );
  }

  return NextResponse.json({
    id: generation.id,
    model: generation.model,
    prompt: generation.prompt,
    result: generation.result,
    usage: generation.tokenUsage,
    costCents: generation.estimatedCostCents,
    status: generation.status,
    error: generation.error,
    createdAt: generation.createdAt,
  });
}
