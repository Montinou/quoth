/**
 * Coverage Calculation Service
 * Shows actual document distribution by type and embedding coverage.
 *
 * Coverage = documents with embeddings / total documents.
 * Also shows breakdown by actual doc_type categories from the database.
 */

import { supabase } from '../supabase';

/**
 * Document types stored in the database
 */
export type DocType = 'architecture' | 'testing-pattern' | 'contract' | 'meta' | 'template' | 'rules' | 'patterns' | 'reference';

/**
 * Count per document type category — now dynamic, keyed by actual doc_type values
 */
export interface CoverageBreakdown {
  [category: string]: { count: number };
}

export interface CoverageResult {
  projectId: string;
  totalDocuments: number;
  docsWithEmbeddings: number;
  totalChunks: number;
  categorizedDocuments: number;
  coveragePercentage: number;
  breakdown: CoverageBreakdown;
  /** Kept for backward compat with coverage_snapshot table */
  totalDocumentable: number;
  totalDocumented: number;
}

/**
 * Infer a doc_type for a document based on its file path.
 * Used to auto-categorize documents with NULL doc_type.
 */
function inferDocType(filePath: string): string {
  if (filePath.includes('playwright-rules')) return 'rules';
  if (filePath.includes('patterns')) return 'patterns';
  return 'reference';
}

/**
 * Auto-categorize documents with NULL doc_type based on their file path.
 * Updates the database in-place so future queries return correct types.
 */
async function autoCategorizeNullDocTypes(projectId: string): Promise<number> {
  // Fetch docs with NULL doc_type
  const { data: nullDocs, error } = await supabase
    .from('documents')
    .select('id, file_path, title')
    .eq('project_id', projectId)
    .is('doc_type', null);

  if (error || !nullDocs || nullDocs.length === 0) return 0;

  let updated = 0;
  for (const doc of nullDocs) {
    const inferredType = inferDocType(doc.file_path || doc.title || '');
    const { error: updateError } = await supabase
      .from('documents')
      .update({ doc_type: inferredType })
      .eq('id', doc.id);

    if (!updateError) updated++;
  }

  console.log(`[Coverage] Auto-categorized ${updated}/${nullDocs.length} documents with NULL doc_type`);
  return updated;
}

/**
 * Calculate documentation coverage for a project.
 * Coverage = documents with embeddings / total documents.
 * Also auto-categorizes any NULL doc_type documents before counting.
 */
export async function calculateCoverage(projectId: string): Promise<CoverageResult> {
  // Step 1: Auto-categorize NULL doc_type documents
  await autoCategorizeNullDocTypes(projectId);

  // Step 2: Query all documents for this project
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, doc_type')
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  const totalDocuments = docs?.length || 0;

  // Step 3: Count distinct document_ids in document_embeddings (docs with embeddings)
  // Batch the query to avoid timeout with large document sets (Vercel 10s limit)
  const BATCH_SIZE = 20;
  const docIds = (docs || []).map((d: any) => d.id);
  const docIdsWithEmbeddings = new Set<string>();
  let totalChunks = 0;

  // Process in batches
  for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
    const batch = docIds.slice(i, i + BATCH_SIZE);
    
    const { data: embeddingData, error: embError } = await supabase
      .from('document_embeddings')
      .select('document_id')
      .in('document_id', batch);

    if (embError) {
      throw new Error(`Failed to fetch embeddings: ${embError.message}`);
    }

    // Collect unique document IDs
    (embeddingData || []).forEach((e: any) => docIdsWithEmbeddings.add(e.document_id));
    totalChunks += embeddingData?.length || 0;
  }

  const docsWithEmbeddings = docIdsWithEmbeddings.size;

  // Step 4: Count documents by actual doc_type (dynamic categories)
  const typeCounts: Record<string, number> = {};
  let uncategorizedCount = 0;

  for (const doc of docs || []) {
    const docType = doc.doc_type;
    if (!docType) {
      uncategorizedCount++;
    } else {
      // Normalize: "testing-pattern" → "testing_pattern" for display key
      const key = docType.replace(/-/g, '_');
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    }
  }

  // Build dynamic breakdown
  const breakdown: CoverageBreakdown = {};
  for (const [key, count] of Object.entries(typeCounts)) {
    breakdown[key] = { count };
  }
  if (uncategorizedCount > 0) {
    breakdown['uncategorized'] = { count: uncategorizedCount };
  }

  // Coverage = docs with embeddings / total docs
  const coveragePercentage =
    totalDocuments > 0 ? Math.round((docsWithEmbeddings / totalDocuments) * 100) : 0;

  const categorizedDocuments = totalDocuments - uncategorizedCount;

  return {
    projectId,
    totalDocuments,
    docsWithEmbeddings,
    totalChunks,
    categorizedDocuments,
    coveragePercentage,
    breakdown,
    // backward compat fields for snapshot table
    totalDocumentable: totalDocuments,
    totalDocumented: docsWithEmbeddings,
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
  const rawBreakdown = data.breakdown as Record<string, { count?: number; documented?: number; expected?: number }>;
  const normalizedBreakdown: CoverageBreakdown = {};

  for (const [key, value] of Object.entries(rawBreakdown)) {
    const count = value?.count ?? value?.documented ?? 0;
    if (count > 0) {
      normalizedBreakdown[key] = { count };
    }
  }

  return {
    projectId: data.project_id,
    totalDocuments: data.total_documentable ?? 0,
    docsWithEmbeddings: data.total_documented ?? 0,
    totalChunks: 0, // Not stored in snapshot, recalculated on scan
    categorizedDocuments: data.total_documented ?? 0,
    coveragePercentage: data.coverage_percentage ?? 0,
    breakdown: normalizedBreakdown,
    totalDocumentable: data.total_documentable,
    totalDocumented: data.total_documented,
  };
}
