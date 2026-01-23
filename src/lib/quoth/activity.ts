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
