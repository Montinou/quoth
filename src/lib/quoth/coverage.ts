/**
 * Coverage Calculation Service
 * Convention-based documentation coverage analysis
 */

import { supabase } from '../supabase';

interface CategoryCoverage {
  documented: number;
  total: number;
}

interface CoverageBreakdown {
  api_endpoints: CategoryCoverage;
  components: CategoryCoverage;
  testing_patterns: CategoryCoverage;
  database_models: CategoryCoverage;
  architecture: CategoryCoverage;
}

interface UndocumentedItem {
  path: string;
  category: keyof CoverageBreakdown;
  suggestion: string;
}

export interface CoverageResult {
  projectId: string;
  totalDocumentable: number;
  totalDocumented: number;
  coveragePercentage: number;
  breakdown: CoverageBreakdown;
  undocumentedItems: UndocumentedItem[];
}

/**
 * Convention-based patterns for detecting documentable items
 * These patterns match file paths to documentation categories
 */
const CONVENTION_PATTERNS: Record<keyof CoverageBreakdown, RegExp[]> = {
  api_endpoints: [
    /\/api\/.*\/route\.(ts|js)$/,
    /\/pages\/api\/.*\.(ts|js)$/,
    /\/app\/api\/.*\/route\.(ts|js)$/,
  ],
  components: [
    /\/components\/.*\.(tsx|jsx)$/,
    /\/src\/components\/.*\.(tsx|jsx)$/,
  ],
  testing_patterns: [
    /\.(test|spec)\.(ts|tsx|js|jsx)$/,
    /\/tests?\/.*\.(ts|tsx|js|jsx)$/,
    /\/__tests__\/.*\.(ts|tsx|js|jsx)$/,
  ],
  database_models: [
    /\/models?\/.*\.(ts|js)$/,
    /\/schema\.(ts|js)$/,
    /\/prisma\/schema\.prisma$/,
    /\/drizzle\/.*\.(ts|js)$/,
  ],
  architecture: [
    /\/lib\/.*\.(ts|js)$/,
    /\/utils\/.*\.(ts|js)$/,
    /\/services\/.*\.(ts|js)$/,
  ],
};

/**
 * Document type mappings for matching against Quoth docs
 */
const CATEGORY_DOC_TYPES: Record<keyof CoverageBreakdown, string[]> = {
  api_endpoints: ['contract', 'api-schema'],
  components: ['architecture', 'pattern'],
  testing_patterns: ['testing-pattern', 'pattern'],
  database_models: ['contract', 'database-model'],
  architecture: ['architecture', 'pattern'],
};

/**
 * Calculate documentation coverage for a project
 * Uses convention-based detection of documentable items
 */
export async function calculateCoverage(
  projectId: string,
  codebasePaths?: string[]
): Promise<CoverageResult> {
  // Fetch existing documents for this project
  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, file_path, title, content')
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  const docs = documents || [];

  // Initialize breakdown
  const breakdown: CoverageBreakdown = {
    api_endpoints: { documented: 0, total: 0 },
    components: { documented: 0, total: 0 },
    testing_patterns: { documented: 0, total: 0 },
    database_models: { documented: 0, total: 0 },
    architecture: { documented: 0, total: 0 },
  };

  const undocumentedItems: UndocumentedItem[] = [];

  // If codebase paths provided, analyze them
  if (codebasePaths && codebasePaths.length > 0) {
    for (const filePath of codebasePaths) {
      for (const [category, patterns] of Object.entries(CONVENTION_PATTERNS)) {
        const categoryKey = category as keyof CoverageBreakdown;
        if (patterns.some((p) => p.test(filePath))) {
          breakdown[categoryKey].total++;

          // Check if documented
          const hasDoc = docs.some((doc) => {
            const content = doc.content?.toLowerCase() || '';
            const normalizedPath = filePath.toLowerCase();
            return (
              content.includes(normalizedPath) ||
              doc.file_path?.toLowerCase().includes(normalizedPath.split('/').pop() || '')
            );
          });

          if (hasDoc) {
            breakdown[categoryKey].documented++;
          } else {
            undocumentedItems.push({
              path: filePath,
              category: categoryKey,
              suggestion: getSuggestion(categoryKey, filePath),
            });
          }
          break; // Only count once per file
        }
      }
    }
  } else {
    // Fallback: count documents by type
    for (const doc of docs) {
      const docPath = doc.file_path?.toLowerCase() || '';
      for (const [category, docTypes] of Object.entries(CATEGORY_DOC_TYPES)) {
        const categoryKey = category as keyof CoverageBreakdown;
        if (docTypes.some((t) => docPath.includes(t))) {
          breakdown[categoryKey].documented++;
          breakdown[categoryKey].total++;
          break;
        }
      }
    }
  }

  // Calculate totals
  const totalDocumentable = Object.values(breakdown).reduce((sum, cat) => sum + cat.total, 0);
  const totalDocumented = Object.values(breakdown).reduce((sum, cat) => sum + cat.documented, 0);
  const coveragePercentage =
    totalDocumentable > 0 ? Math.round((totalDocumented / totalDocumentable) * 100) : 0;

  return {
    projectId,
    totalDocumentable,
    totalDocumented,
    coveragePercentage,
    breakdown,
    undocumentedItems: undocumentedItems.slice(0, 20), // Limit to top 20
  };
}

function getSuggestion(category: keyof CoverageBreakdown, _filePath: string): string {
  const suggestions: Record<keyof CoverageBreakdown, string> = {
    api_endpoints: 'Create API schema documentation',
    components: 'Document component patterns and props',
    testing_patterns: 'Add testing pattern documentation',
    database_models: 'Create data model documentation',
    architecture: 'Document architectural patterns',
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
  };
}
