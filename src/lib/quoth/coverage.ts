/**
 * Coverage Calculation Service
 * Shows actual document distribution by type and categorization coverage.
 *
 * Coverage = percentage of documents that have a doc_type assigned.
 * Uncategorized documents (doc_type = null) represent gaps.
 */

import { supabase } from '../supabase';

/**
 * Document types stored in the database
 */
export type DocType = 'architecture' | 'testing-pattern' | 'contract' | 'meta' | 'template';

/**
 * Count per document type category
 */
interface CategoryCount {
  count: number;
}

/**
 * Coverage breakdown by document type
 */
interface CoverageBreakdown {
  architecture: CategoryCount;
  testing_pattern: CategoryCount;
  contract: CategoryCount;
  meta: CategoryCount;
  uncategorized: CategoryCount;
}

export interface CoverageResult {
  projectId: string;
  totalDocuments: number;
  categorizedDocuments: number;
  coveragePercentage: number;
  breakdown: CoverageBreakdown;
  /** Kept for backward compat with coverage_snapshot table */
  totalDocumentable: number;
  totalDocumented: number;
}

/**
 * Calculate documentation coverage for a project.
 * Coverage = categorized documents / total documents.
 */
export async function calculateCoverage(projectId: string): Promise<CoverageResult> {
  // Query documents grouped by doc_type for this project
  const { data: docs, error } = await supabase
    .from('documents')
    .select('doc_type')
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  // Count documents by type
  const counts = {
    architecture: 0,
    testing_pattern: 0,
    contract: 0,
    meta: 0,
    uncategorized: 0,
  };

  for (const doc of docs || []) {
    const docType = doc.doc_type;
    if (docType === 'architecture') counts.architecture++;
    else if (docType === 'testing-pattern') counts.testing_pattern++;
    else if (docType === 'contract') counts.contract++;
    else if (docType === 'meta') counts.meta++;
    else counts.uncategorized++;
  }

  const totalDocuments = docs?.length || 0;
  const categorizedDocuments = totalDocuments - counts.uncategorized;
  const coveragePercentage =
    totalDocuments > 0 ? Math.round((categorizedDocuments / totalDocuments) * 100) : 0;

  const breakdown: CoverageBreakdown = {
    architecture: { count: counts.architecture },
    testing_pattern: { count: counts.testing_pattern },
    contract: { count: counts.contract },
    meta: { count: counts.meta },
    uncategorized: { count: counts.uncategorized },
  };

  return {
    projectId,
    totalDocuments,
    categorizedDocuments,
    coveragePercentage,
    breakdown,
    // backward compat fields for snapshot table
    totalDocumentable: totalDocuments,
    totalDocumented: categorizedDocuments,
  };
}

/**
 * Save coverage snapshot to database
 */
export async function saveCoverageSnapshot(
  coverage: CoverageResult,
  scanType: 'manual' | 'scheduled' | 'genesis' = 'manual'
): Promise<void> {
  const { error } = await supabase.from('coverage_snapshot').insert({
    project_id: coverage.projectId,
    total_documentable: coverage.totalDocumentable,
    total_documented: coverage.totalDocumented,
    coverage_percentage: coverage.coveragePercentage,
    breakdown: coverage.breakdown,
    undocumented_items: [],
    scan_type: scanType,
  });

  if (error) {
    throw new Error(`Failed to save coverage snapshot: ${error.message}`);
  }
}

/**
 * Get latest coverage snapshot for a project
 */
export async function getLatestCoverage(projectId: string): Promise<CoverageResult | null> {
  const { data, error } = await supabase
    .from('coverage_snapshot')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  // Handle both old-format (with documented/expected) and new-format (with count) snapshots
  const breakdown = data.breakdown as Record<string, { count?: number; documented?: number; expected?: number }>;
  const normalizedBreakdown: CoverageBreakdown = {
    architecture: { count: breakdown.architecture?.count ?? breakdown.architecture?.documented ?? 0 },
    testing_pattern: { count: breakdown.testing_pattern?.count ?? breakdown.testing_pattern?.documented ?? 0 },
    contract: { count: breakdown.contract?.count ?? breakdown.contract?.documented ?? 0 },
    meta: { count: breakdown.meta?.count ?? 0 },
    uncategorized: { count: breakdown.uncategorized?.count ?? 0 },
  };

  return {
    projectId: data.project_id,
    totalDocuments: data.total_documentable ?? 0,
    categorizedDocuments: data.total_documented ?? 0,
    coveragePercentage: data.coverage_percentage ?? 0,
    breakdown: normalizedBreakdown,
    totalDocumentable: data.total_documentable,
    totalDocumented: data.total_documented,
  };
}
