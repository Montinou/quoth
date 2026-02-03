'use client';

/**
 * Coverage Card Component
 * Displays actual document distribution by type and categorization coverage.
 * Coverage = percentage of documents that have a doc_type assigned.
 */

import { useState } from 'react';
import {
  PieChart,
  RefreshCw,
  FileText,
  Layers,
  Code2,
  ShieldCheck,
  BookOpen,
  HelpCircle,
} from 'lucide-react';

interface CategoryCount {
  count: number;
}

interface CoverageBreakdown {
  architecture: CategoryCount;
  testing_pattern: CategoryCount;
  contract: CategoryCount;
  meta: CategoryCount;
  uncategorized: CategoryCount;
}

interface CoverageData {
  coveragePercentage: number;
  totalDocuments: number;
  categorizedDocuments: number;
  breakdown: CoverageBreakdown;
}

interface CoverageCardProps {
  projectId: string;
  initialCoverage?: CoverageData | null;
}

const CATEGORY_CONFIG: Record<
  keyof CoverageBreakdown,
  { label: string; icon: typeof FileText; color: string; barColor: string }
> = {
  architecture: {
    label: 'Architecture',
    icon: Layers,
    color: 'text-violet-spectral',
    barColor: 'bg-violet-spectral',
  },
  testing_pattern: {
    label: 'Testing Patterns',
    icon: Code2,
    color: 'text-blue-400',
    barColor: 'bg-blue-400',
  },
  contract: {
    label: 'Contracts',
    icon: ShieldCheck,
    color: 'text-emerald-muted',
    barColor: 'bg-emerald-muted',
  },
  meta: {
    label: 'Meta',
    icon: BookOpen,
    color: 'text-amber-warning',
    barColor: 'bg-amber-warning',
  },
  uncategorized: {
    label: 'Uncategorized',
    icon: HelpCircle,
    color: 'text-gray-500',
    barColor: 'bg-gray-500',
  },
};

export function CoverageCard({ projectId, initialCoverage }: CoverageCardProps) {
  const [coverage, setCoverage] = useState<CoverageData | null>(initialCoverage || null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error('Failed to scan coverage');
      }

      const data = await res.json();
      setCoverage(data.coverage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const getProgressColor = (percentage: number): string => {
    if (percentage >= 80) return 'bg-emerald-muted';
    if (percentage >= 50) return 'bg-amber-warning';
    return 'bg-red-500';
  };

  const totalDocs = coverage?.totalDocuments ?? 0;

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-spectral/15">
            <PieChart className="w-5 h-5 text-violet-spectral" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Documentation Coverage</h3>
            <p className="text-sm text-gray-500">Document categorization overview</p>
          </div>
        </div>
        <button
          onClick={handleScan}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg
            bg-violet-spectral/20 text-violet-ghost hover:bg-violet-spectral/30
            border border-violet-spectral/30 transition-all duration-300
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className={isLoading ? 'animate-spin' : ''}>
            <RefreshCw className="w-4 h-4" />
          </div>
          {isLoading ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {coverage ? (
        <>
          {/* Overall Coverage */}
          <div className="mb-6">
            <div className="flex items-end justify-between mb-2">
              <span className="text-4xl font-bold text-white">
                {coverage.coveragePercentage}%
              </span>
              <span className="text-sm text-gray-500">
                {coverage.categorizedDocuments} of {coverage.totalDocuments} categorized
              </span>
            </div>
            <div className="h-2 rounded-full bg-charcoal overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getProgressColor(coverage.coveragePercentage)}`}
                style={{ width: `${coverage.coveragePercentage}%` }}
              />
            </div>
            {coverage.breakdown.uncategorized.count > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {coverage.breakdown.uncategorized.count} document{coverage.breakdown.uncategorized.count !== 1 ? 's' : ''} without a doc_type — consider categorizing them
              </p>
            )}
          </div>

          {/* Category Breakdown */}
          <div className="space-y-3">
            {(Object.entries(coverage.breakdown) as [keyof CoverageBreakdown, CategoryCount][]).map(
              ([key, value]) => {
                if (value.count === 0) return null;
                const config = CATEGORY_CONFIG[key];
                const Icon = config.icon;
                const percentage = totalDocs > 0 ? (value.count / totalDocs) * 100 : 0;

                return (
                  <div key={key} className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${config.color} shrink-0`} />
                    <span className="text-sm text-gray-400 w-36 truncate">
                      {config.label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-charcoal overflow-hidden">
                      <div
                        className={`h-full rounded-full ${config.barColor}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right font-mono">
                      {value.count}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <div className="inline-flex p-3 rounded-2xl bg-violet-spectral/10 mb-3">
            <PieChart className="w-6 h-6 text-violet-spectral" />
          </div>
          <p className="text-gray-400 mb-3">No coverage data available</p>
          <p className="text-sm text-gray-500">
            Click &quot;Scan&quot; to analyze documentation coverage
          </p>
        </div>
      )}
    </div>
  );
}
