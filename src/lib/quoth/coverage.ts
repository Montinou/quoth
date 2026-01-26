/**
 * Coverage Calculation Service
 * Document-type-based documentation coverage analysis
 *
 * This calculates coverage based on actual document types stored in the database,
 * aligned with Genesis phases:
 * - Phase 1-2: Architecture (project-overview, tech-stack, repo-structure)
 * - Phase 3: Patterns (coding-conventions, testing-patterns)
 * - Phase 4: Contracts (api-schemas, database-models, shared-types)
 */

import { supabase } from '../supabase';

/**
 * Document types aligned with Genesis phases
 */
export type DocType = 'architecture' | 'testing-pattern' | 'contract' | 'meta' | 'template';

/**
 * Coverage per category - documented vs expected
 */
interface CategoryCoverage {
  documented: number;
  expected: number;
}

/**
 * Coverage breakdown by document type
 * Aligned with actual doc_type column values
 */
interface CoverageBreakdown {
  architecture: CategoryCoverage;
  testing_pattern: CategoryCoverage;
  contract: CategoryCoverage;
}

interface UndocumentedItem {
  category: keyof CoverageBreakdown;
  suggestion: string;
  expectedDoc: string;
}

export interface CoverageResult {
  projectId: string;
  totalDocumentable: number;
  totalDocumented: number;
  coveragePercentage: number;
  breakdown: CoverageBreakdown;
  undocumentedItems: UndocumentedItem[];
  genesisDepth: 'minimal' | 'standard' | 'comprehensive' | 'unknown';
}

/**
 * Expected documents per Genesis depth level
 * Based on Genesis v2.0 phases
 */
const GENESIS_EXPECTATIONS = {
  minimal: {
    architecture: 3, // project-overview, tech-stack, repo-structure
    testing_pattern: 0,
    contract: 0,
  },
  standard: {
    architecture: 3, // project-overview, tech-stack, repo-structure
    testing_pattern: 2, // coding-conventions, testing-patterns
    contract: 0,
  },
  comprehensive: {
    architecture: 3, // project-overview, tech-stack, repo-structure
    testing_pattern: 4, // coding-conventions, testing-patterns, error-handling, security-patterns
    contract: 3, // api-schemas, database-models, shared-types
  },
} as const;

/**
 * Expected document names per category (for undocumented suggestions)
 */
const EXPECTED_DOCS: Record<keyof CoverageBreakdown, string[]> = {
  architecture: ['project-overview.md', 'tech-stack.md', 'repo-structure.md'],
  testing_pattern: ['coding-conventions.md', 'testing-patterns.md', 'error-handling.md', 'security-patterns.md'],
  contract: ['api-schemas.md', 'database-models.md', 'shared-types.md'],
};

/**
 * Infer Genesis depth from existing document counts
 */
function inferGenesisDepth(
  architectureCount: number,
  patternCount: number,
  contractCount: number
): 'minimal' | 'standard' | 'comprehensive' | 'unknown' {
  // Comprehensive: has contracts
  if (contractCount > 0) {
    return 'comprehensive';
  }
  // Standard: has patterns but no contracts
  if (patternCount > 0) {
    return 'standard';
  }
  // Minimal: only architecture
  if (architectureCount > 0) {
    return 'minimal';
  }
  // Unknown: no documents
  return 'unknown';
}

/**
 * Calculate documentation coverage for a project
 * Uses doc_type column for fast, accurate categorization
 */
export async function calculateCoverage(projectId: string): Promise<CoverageResult> {
  // Query documents grouped by doc_type for this project
  const { data: typeCounts, error } = await supabase
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
    template: 0,
    unknown: 0,
  };

  for (const doc of typeCounts || []) {
    const docType = doc.doc_type;
    if (docType === 'architecture') counts.architecture++;
    else if (docType === 'testing-pattern') counts.testing_pattern++;
    else if (docType === 'contract') counts.contract++;
    else if (docType === 'meta') counts.meta++;
    else if (docType === 'template') counts.template++;
    else counts.unknown++;
  }

  // Infer Genesis depth based on what's documented
  const genesisDepth = inferGenesisDepth(
    counts.architecture,
    counts.testing_pattern,
    counts.contract
  );

  // Get expected counts for this depth (default to standard if unknown)
  const expectedDepth = genesisDepth === 'unknown' ? 'standard' : genesisDepth;
  const expectations = GENESIS_EXPECTATIONS[expectedDepth];

  // Build breakdown
  const breakdown: CoverageBreakdown = {
    architecture: {
      documented: counts.architecture,
      expected: expectations.architecture,
    },
    testing_pattern: {
      documented: counts.testing_pattern,
      expected: expectations.testing_pattern,
    },
    contract: {
      documented: counts.contract,
      expected: expectations.contract,
    },
  };

  // Calculate totals (only count categories with expected > 0)
  const totalDocumentable = Object.values(breakdown).reduce(
    (sum, cat) => sum + cat.expected,
    0
  );
  const totalDocumented = Object.values(breakdown).reduce(
    (sum, cat) => sum + Math.min(cat.documented, cat.expected),
    0
  );
  const coveragePercentage =
    totalDocumentable > 0 ? Math.round((totalDocumented / totalDocumentable) * 100) : 0;

  // Generate undocumented suggestions
  const undocumentedItems = generateUndocumentedSuggestions(breakdown);

  return {
    projectId,
    totalDocumentable,
    totalDocumented,
    coveragePercentage,
    breakdown,
    undocumentedItems,
    genesisDepth,
  };
}

/**
 * Generate suggestions for missing documentation
 */
function generateUndocumentedSuggestions(
  breakdown: CoverageBreakdown
): UndocumentedItem[] {
  const suggestions: UndocumentedItem[] = [];

  for (const [category, coverage] of Object.entries(breakdown)) {
    const categoryKey = category as keyof CoverageBreakdown;
    const missing = coverage.expected - coverage.documented;

    if (missing > 0) {
      const expectedDocs = EXPECTED_DOCS[categoryKey];
      const missingDocs = expectedDocs.slice(coverage.documented, coverage.expected);

      for (const doc of missingDocs) {
        suggestions.push({
          category: categoryKey,
          suggestion: getSuggestion(categoryKey),
          expectedDoc: doc,
        });
      }
    }
  }

  return suggestions.slice(0, 10); // Limit to top 10
}

function getSuggestion(category: keyof CoverageBreakdown): string {
  const suggestions: Record<keyof CoverageBreakdown, string> = {
    architecture: 'Document project structure and technology choices',
    testing_pattern: 'Add testing and coding convention patterns',
    contract: 'Create API and data model documentation',
  };
  return suggestions[category];
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
    breakdown: coverage.breakdown,
    undocumented_items: coverage.undocumentedItems,
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

  return {
    projectId: data.project_id,
    totalDocumentable: data.total_documentable,
    totalDocumented: data.total_documented,
    coveragePercentage: data.coverage_percentage,
    breakdown: data.breakdown as CoverageBreakdown,
    undocumentedItems: data.undocumented_items as UndocumentedItem[],
    genesisDepth: 'unknown', // Not stored in snapshot, would need schema change
  };
}
