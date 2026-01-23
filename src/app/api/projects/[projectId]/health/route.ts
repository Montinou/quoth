/**
 * Document Health API
 * GET: Fetch project health summary and staleness indicators
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getProjectHealth, getDocumentsNeedingAttention } from '@/lib/quoth/health';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const needingAttentionOnly = searchParams.get('needingAttention') === 'true';
  const limit = parseInt(searchParams.get('limit') || '10', 10);

  // Verify authentication
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Not a project member' }, { status: 403 });
  }

  try {
    if (needingAttentionOnly) {
      const documents = await getDocumentsNeedingAttention(projectId, limit);
      return NextResponse.json({ documents });
    }

    const health = await getProjectHealth(projectId);
    return NextResponse.json({ health });
  } catch (error) {
    console.error('[Health API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 });
  }
}
