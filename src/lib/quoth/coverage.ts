/**
 * Coverage Calculation Service
 * Shows actual document distribution by type and embedding coverage.
 *
 * Uses Neon + Drizzle.
 * Coverage = documents with embeddings / total documents.
 */

import { getDb } from '@/db/connection';
import { sql } from 'drizzle-orm';

/**
 * Document types stored in the database
 */
export type DocType = 'architecture' | 'testing-pattern' | 'contract' | 'meta' | 'template' | 'rules' | 'patterns' | 'reference';

/**
 * Count per document type category — dynamic, keyed by actual doc_type values
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
 * Get latest coverage snapshot for a project.
 * Returns null if no snapshot exists (the dashboard handles null gracefully).
 */
export async function getLatestCoverage(projectId: string): Promise<CoverageResult | null> {
  try {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT *
      FROM analytics.coverage_snapshots
      WHERE project_id = ${projectId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    // Handle both old-format (with documented/expected) and new-format (with count) snapshots
    const rawBreakdown = (row.breakdown ?? {}) as Record<string, { count?: number; documented?: number; expected?: number }>;
    const normalizedBreakdown: CoverageBreakdown = {};

    for (const [key, value] of Object.entries(rawBreakdown)) {
      const count = value?.count ?? value?.documented ?? 0;
      if (count > 0) {
        normalizedBreakdown[key] = { count };
      }
    }

    return {
      projectId: row.project_id as string,
      totalDocuments: (row.total_documentable as number) ?? 0,
      docsWithEmbeddings: (row.total_documented as number) ?? 0,
      totalChunks: 0, // Not stored in snapshot, recalculated on scan
      categorizedDocuments: (row.total_documented as number) ?? 0,
      coveragePercentage: (row.coverage_percentage as number) ?? 0,
      breakdown: normalizedBreakdown,
      totalDocumentable: row.total_documentable as number,
      totalDocumented: row.total_documented as number,
    };
  } catch (error) {
    console.warn('[Coverage] Failed to fetch latest coverage:', error);
    return null;
  }
}
