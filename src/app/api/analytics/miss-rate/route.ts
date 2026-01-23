/**
 * Miss Rate Analytics API
 * GET: Fetch miss rate trends and top missed queries
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getMissRateTrends, getTopMissedQueries } from '@/lib/quoth/activity';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const period = searchParams.get('period') || '7d';

  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 });
  }

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
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;

    const [trends, topMissed] = await Promise.all([
      getMissRateTrends(projectId, days),
      getTopMissedQueries(projectId, 10),
    ]);

    return NextResponse.json({
      trends,
      topMissed,
    });
  } catch (error) {
    console.error('[Miss Rate API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch miss rate data' }, { status: 500 });
  }
}
