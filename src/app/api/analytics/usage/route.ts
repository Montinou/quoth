/**
 * Usage Analytics API
 * GET /api/analytics/usage
 *
 * Returns aggregated usage statistics for a project:
 * - Total queries
 * - Queries by event type
 * - Queries per day
 * - Top search queries
 * - Average results per search
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get project_id from query params
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const period = searchParams.get('period') || '7d'; // 7d, 30d, 90d

  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 });
  }

  // Verify user has access to this project
  const { data: membership, error: membershipError } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (membershipError || !membership) {
    return NextResponse.json({ error: 'Project not found or access denied' }, { status: 403 });
  }

  // Calculate date range
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch activity stats
  const { data: activity, error } = await supabase
    .from('quoth_activity')
    .select('event_type, query, created_at, result_count')
    .eq('project_id', projectId)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Analytics] Error fetching activity:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }

  // Aggregate stats
  const stats = {
    totalQueries: activity?.length || 0,
    byEventType: {} as Record<string, number>,
    queriesPerDay: {} as Record<string, number>,
    topSearches: [] as { query: string; count: number }[],
    avgResultsPerSearch: 0,
  };

  const searchQueries: Record<string, number> = {};
  let totalResults = 0;
  let searchCount = 0;

  activity?.forEach((item) => {
    // By event type
    stats.byEventType[item.event_type] = (stats.byEventType[item.event_type] || 0) + 1;

    // By day
    const day = new Date(item.created_at).toISOString().split('T')[0];
    stats.queriesPerDay[day] = (stats.queriesPerDay[day] || 0) + 1;

    // Search queries
    if (item.event_type === 'search' && item.query) {
      searchQueries[item.query] = (searchQueries[item.query] || 0) + 1;
      if (item.result_count !== null) {
        totalResults += item.result_count;
        searchCount++;
      }
    }
  });

  // Top searches
  stats.topSearches = Object.entries(searchQueries)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Avg results
  stats.avgResultsPerSearch = searchCount > 0 ? Math.round(totalResults / searchCount) : 0;

  return NextResponse.json(stats);
}
