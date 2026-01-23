/**
 * Activity Logging Service
 * Tracks all Quoth tool activity for analytics dashboard
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use service role for activity logging (bypasses RLS for inserts)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type ActivityEventType =
  | 'search'
  | 'read'
  | 'read_chunks'
  | 'propose'
  | 'genesis'
  | 'pattern_match'
  | 'pattern_inject'
  | 'drift_detected'
  | 'coverage_scan';

export interface ActivityLogParams {
  projectId: string;
  userId?: string;
  eventType: ActivityEventType;
  query?: string;
  documentId?: string;
  patternsMatched?: string[];
  driftDetected?: boolean;
  resultCount?: number;
  relevanceScore?: number;
  responseTimeMs?: number;
  toolName?: string;
  filePath?: string;
  context?: Record<string, unknown>;
}

/**
 * Log an activity event to the database.
 * Non-blocking - errors are logged but don't throw.
 */
export async function logActivity(params: ActivityLogParams): Promise<void> {
  try {
    const { error } = await supabase
      .from('quoth_activity')
      .insert({
        project_id: params.projectId,
        user_id: params.userId || null,
        event_type: params.eventType,
        query: params.query || null,
        document_id: params.documentId || null,
        patterns_matched: params.patternsMatched || null,
        drift_detected: params.driftDetected ?? false,
        result_count: params.resultCount ?? null,
        relevance_score: params.relevanceScore ?? null,
        response_time_ms: params.responseTimeMs ?? null,
        tool_name: params.toolName || null,
        file_path: params.filePath || null,
        context: params.context || {},
      });

    if (error) {
      console.error('[Activity] Failed to log activity:', error.message);
    }
  } catch (err) {
    // Non-blocking - don't let logging failures affect tool execution
    console.error('[Activity] Unexpected error:', err);
  }
}

/**
 * Helper to measure and log activity with timing.
 */
export function createActivityLogger(baseParams: Omit<ActivityLogParams, 'responseTimeMs'>) {
  const startTime = Date.now();

  return {
    complete: (overrides?: Partial<ActivityLogParams>) => {
      const responseTimeMs = Date.now() - startTime;
      logActivity({
        ...baseParams,
        ...overrides,
        responseTimeMs,
      });
    },
  };
}

/**
 * Get activity summary for a project (for dashboard)
 */
export async function getActivitySummary(
  projectId: string,
  days: number = 7
): Promise<{
  totalQueries: number;
  searchCount: number;
  readCount: number;
  proposeCount: number;
  topSearchTerms: Array<{ query: string; count: number }>;
  missRate: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: activities, error } = await supabase
    .from('quoth_activity')
    .select('event_type, query, result_count')
    .eq('project_id', projectId)
    .gte('created_at', since.toISOString());

  if (error || !activities) {
    return {
      totalQueries: 0,
      searchCount: 0,
      readCount: 0,
      proposeCount: 0,
      topSearchTerms: [],
      missRate: 0,
    };
  }

  const searchCount = activities.filter((a) => a.event_type === 'search').length;
  const readCount = activities.filter((a) => a.event_type === 'read' || a.event_type === 'read_chunks').length;
  const proposeCount = activities.filter((a) => a.event_type === 'propose').length;

  // Calculate miss rate (searches with 0 results)
  const searches = activities.filter((a) => a.event_type === 'search');
  const misses = searches.filter((a) => (a.result_count ?? 0) === 0).length;
  const missRate = searches.length > 0 ? (misses / searches.length) * 100 : 0;

  // Top search terms
  const queryCount = new Map<string, number>();
  searches.forEach((s) => {
    if (s.query) {
      const normalized = s.query.toLowerCase().trim();
      queryCount.set(normalized, (queryCount.get(normalized) || 0) + 1);
    }
  });
  const topSearchTerms = Array.from(queryCount.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalQueries: activities.length,
    searchCount,
    readCount,
    proposeCount,
    topSearchTerms,
    missRate: Math.round(missRate * 10) / 10,
  };
}

/**
 * Get miss rate trends over time
 */
export async function getMissRateTrends(
  projectId: string,
  days: number = 7
): Promise<{
  dailyMissRates: Array<{ date: string; missRate: number; searchCount: number }>;
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: activities, error } = await supabase
    .from('quoth_activity')
    .select('event_type, result_count, created_at')
    .eq('project_id', projectId)
    .eq('event_type', 'search')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error || !activities) {
    return {
      dailyMissRates: [],
      averageMissRate: 0,
      trend: 'stable',
    };
  }

  // Group by date
  const byDate = new Map<string, { searches: number; misses: number }>();

  activities.forEach((a) => {
    const date = new Date(a.created_at).toISOString().split('T')[0];
    const current = byDate.get(date) || { searches: 0, misses: 0 };
    current.searches++;
    if ((a.result_count ?? 0) === 0) {
      current.misses++;
    }
    byDate.set(date, current);
  });

  const dailyMissRates = Array.from(byDate.entries()).map(([date, stats]) => ({
    date,
    missRate: stats.searches > 0 ? Math.round((stats.misses / stats.searches) * 100) : 0,
    searchCount: stats.searches,
  }));

  // Calculate average
  const totalMisses = activities.filter((a) => (a.result_count ?? 0) === 0).length;
  const averageMissRate = activities.length > 0
    ? Math.round((totalMisses / activities.length) * 100)
    : 0;

  // Determine trend (compare first half vs second half)
  const mid = Math.floor(dailyMissRates.length / 2);
  const firstHalf = dailyMissRates.slice(0, mid);
  const secondHalf = dailyMissRates.slice(mid);

  const avgFirst = firstHalf.length > 0
    ? firstHalf.reduce((sum, d) => sum + d.missRate, 0) / firstHalf.length
    : 0;
  const avgSecond = secondHalf.length > 0
    ? secondHalf.reduce((sum, d) => sum + d.missRate, 0) / secondHalf.length
    : 0;

  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (avgSecond < avgFirst - 5) trend = 'improving';
  else if (avgSecond > avgFirst + 5) trend = 'degrading';

  return {
    dailyMissRates,
    averageMissRate,
    trend,
  };
}

/**
 * Get queries that resulted in zero results (gaps in documentation)
 */
export async function getTopMissedQueries(
  projectId: string,
  limit: number = 10
): Promise<Array<{ query: string; missCount: number; lastMissed: string }>> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: activities, error } = await supabase
    .from('quoth_activity')
    .select('query, created_at')
    .eq('project_id', projectId)
    .eq('event_type', 'search')
    .eq('result_count', 0)
    .gte('created_at', thirtyDaysAgo.toISOString());

  if (error || !activities) {
    return [];
  }

  // Count misses per query
  const queryMisses = new Map<string, { count: number; lastMissed: string }>();

  activities.forEach((a) => {
    if (a.query) {
      const normalized = a.query.toLowerCase().trim();
      const existing = queryMisses.get(normalized);
      if (!existing || new Date(a.created_at) > new Date(existing.lastMissed)) {
        queryMisses.set(normalized, {
          count: (existing?.count || 0) + 1,
          lastMissed: a.created_at,
        });
      } else {
        existing.count++;
      }
    }
  });

  return Array.from(queryMisses.entries())
    .map(([query, stats]) => ({
      query,
      missCount: stats.count,
      lastMissed: stats.lastMissed,
    }))
    .sort((a, b) => b.missCount - a.missCount)
    .slice(0, limit);
}
