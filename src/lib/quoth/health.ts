/**
 * Document Health Service
 * Calculates staleness indicators and health metrics
 */

import { supabase } from '../supabase';

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'critical';

export interface StalenessResult {
  level: StalenessLevel;
  daysStale: number;
  lastUpdated: Date;
  suggestedAction?: string;
}

export interface DocumentHealth {
  documentId: string;
  title: string;
  filePath: string;
  staleness: StalenessResult;
  lastReadCount: number;
  searchHitRate: number;
}

export interface ProjectHealthSummary {
  totalDocs: number;
  freshDocs: number;
  agingDocs: number;
  staleDocs: number;
  criticalDocs: number;
  overallScore: number; // 0-100
  documents: DocumentHealth[];
}

// Staleness thresholds (in days)
const THRESHOLDS = {
  fresh: 14,    // < 14 days = fresh
  aging: 30,    // 14-30 days = aging
  stale: 60,    // 30-59 days = stale
  critical: 60, // >= 60 days = critical
};

/**
 * Calculate staleness level from last update date
 */
export function calculateStaleness(lastUpdated: Date | string): StalenessResult {
  const lastDate = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  const daysStale = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let level: StalenessLevel;
  let suggestedAction: string | undefined;

  if (daysStale < THRESHOLDS.fresh) {
    level = 'fresh';
  } else if (daysStale < THRESHOLDS.aging) {
    level = 'aging';
    suggestedAction = 'Review for accuracy';
  } else if (daysStale < THRESHOLDS.stale) {
    level = 'stale';
    suggestedAction = 'Update recommended';
  } else {
    level = 'critical';
    suggestedAction = 'Urgent update required';
  }

  return {
    level,
    daysStale,
    lastUpdated: lastDate,
    suggestedAction,
  };
}

/**
 * Get health metrics for a single document
 */
export async function getDocumentHealth(
  documentId: string,
  projectId: string
): Promise<DocumentHealth | null> {
  // Fetch document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, title, file_path, last_updated')
    .eq('id', documentId)
    .eq('project_id', projectId)
    .single();

  if (docError || !doc) {
    return null;
  }

  // Fetch activity stats for this document
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: activities } = await supabase
    .from('quoth_activity')
    .select('event_type, result_count')
    .eq('project_id', projectId)
    .eq('document_id', documentId)
    .gte('created_at', thirtyDaysAgo.toISOString());

  const readCount = activities?.filter((a: any) => a.event_type === 'read').length || 0;
  const searchHits = activities?.filter((a: any) =>
    a.event_type === 'search' && (a.result_count ?? 0) > 0
  ).length || 0;
  const totalSearches = activities?.filter((a: any) => a.event_type === 'search').length || 1;

  return {
    documentId: doc.id,
    title: doc.title,
    filePath: doc.file_path,
    staleness: calculateStaleness(doc.last_updated),
    lastReadCount: readCount,
    searchHitRate: Math.round((searchHits / totalSearches) * 100),
  };
}

/**
 * Get health summary for all documents in a project
 */
export async function getProjectHealth(projectId: string): Promise<ProjectHealthSummary> {
  // Fetch all documents
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, title, file_path, last_updated')
    .eq('project_id', projectId)
    .order('last_updated', { ascending: true });

  if (error || !docs) {
    return {
      totalDocs: 0,
      freshDocs: 0,
      agingDocs: 0,
      staleDocs: 0,
      criticalDocs: 0,
      overallScore: 0,
      documents: [],
    };
  }

  const documents: DocumentHealth[] = docs.map((doc: any) => {
    const staleness = calculateStaleness(doc.last_updated);
    return {
      documentId: doc.id,
      title: doc.title,
      filePath: doc.file_path,
      staleness,
      lastReadCount: 0, // Would need batch query for performance
      searchHitRate: 0,
    };
  });

  // Count by staleness level
  const counts = {
    fresh: documents.filter((d) => d.staleness.level === 'fresh').length,
    aging: documents.filter((d) => d.staleness.level === 'aging').length,
    stale: documents.filter((d) => d.staleness.level === 'stale').length,
    critical: documents.filter((d) => d.staleness.level === 'critical').length,
  };

  // Calculate overall health score (weighted)
  // Fresh = 100%, Aging = 70%, Stale = 30%, Critical = 0%
  const totalDocs = documents.length || 1;
  const overallScore = Math.round(
    ((counts.fresh * 100 + counts.aging * 70 + counts.stale * 30 + counts.critical * 0) / totalDocs)
  );

  return {
    totalDocs: documents.length,
    freshDocs: counts.fresh,
    agingDocs: counts.aging,
    staleDocs: counts.stale,
    criticalDocs: counts.critical,
    overallScore,
    documents: documents.sort((a, b) => {
      // Sort by staleness level (worst first)
      const order: Record<StalenessLevel, number> = { critical: 0, stale: 1, aging: 2, fresh: 3 };
      return order[a.staleness.level] - order[b.staleness.level];
    }),
  };
}

/**
 * Get documents that need attention (stale or critical)
 */
export async function getDocumentsNeedingAttention(
  projectId: string,
  limit: number = 10
): Promise<DocumentHealth[]> {
  const health = await getProjectHealth(projectId);
  return health.documents
    .filter((d) => d.staleness.level === 'stale' || d.staleness.level === 'critical')
    .slice(0, limit);
}
