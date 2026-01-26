'use client';

/**
 * Coverage Card Component
 * Displays documentation coverage metrics with visual breakdown
 * Aligned with Genesis phases and document types
 */

import { useState } from 'react';
import {
  PieChart,
  FileText,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';

interface CategoryCoverage {
  documented: number;
  expected: number;
}

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

interface CoverageData {
  coveragePercentage: number;
  totalDocumentable: number;
  totalDocumented: number;
  breakdown: CoverageBreakdown;
  undocumentedItems: UndocumentedItem[];
  genesisDepth?: 'minimal' | 'standard' | 'comprehensive' | 'unknown';
}

interface CoverageCardProps {
  projectId: string;
  initialCoverage?: CoverageData | null;
}

const CATEGORY_LABELS: Record<keyof CoverageBreakdown, string> = {
  architecture: 'Architecture',
  testing_pattern: 'Testing Patterns',
  contract: 'Contracts',
};

const GENESIS_DEPTH_LABELS: Record<string, { label: string; color: string }> = {
  minimal: { label: 'Minimal', color: 'text-gray-400' },
  standard: { label: 'Standard', color: 'text-violet-ghost' },
  comprehensive: { label: 'Comprehensive', color: 'text-emerald-muted' },
  unknown: { label: 'Unknown', color: 'text-gray-500' },
};

export function CoverageCard({ projectId, initialCoverage }: CoverageCardProps) {
  const [coverage, setCoverage] = useState<CoverageData | null>(initialCoverage || null);
  const [isLoading, setIsLoading] = useState(false);
  const [showUndocumented, setShowUndocumented] = useState(false);
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

  const getCategoryPercentage = (cat: CategoryCoverage): number => {
    return cat.expected > 0 ? Math.round((cat.documented / cat.expected) * 100) : 0;
  };

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
            <p className="text-sm text-gray-500">Genesis-aligned analysis</p>
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
          {/* Wrap SVG in div for hardware-accelerated animation */}
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
          {/* Genesis Depth Indicator */}
          {coverage.genesisDepth && coverage.genesisDepth !== 'unknown' && (
            <div className="mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-500">Genesis Depth:</span>
              <span className={`text-sm font-medium ${GENESIS_DEPTH_LABELS[coverage.genesisDepth]?.color || 'text-gray-400'}`}>
                {GENESIS_DEPTH_LABELS[coverage.genesisDepth]?.label || 'Unknown'}
              </span>
            </div>
          )}

          {/* Overall Coverage */}
          <div className="mb-6">
            <div className="flex items-end justify-between mb-2">
              <span className="text-4xl font-bold text-white">
                {coverage.coveragePercentage}%
              </span>
              <span className="text-sm text-gray-500">
                {coverage.totalDocumented}/{coverage.totalDocumentable} documented
              </span>
            </div>
            <div className="h-2 rounded-full bg-charcoal overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getProgressColor(coverage.coveragePercentage)}`}
                style={{ width: `${coverage.coveragePercentage}%` }}
              />
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="space-y-3 mb-6">
            {Object.entries(coverage.breakdown).map(([key, value]) => {
              const categoryKey = key as keyof CoverageBreakdown;
              const percentage = getCategoryPercentage(value);
              // Skip categories with 0 expected (not applicable for this depth)
              if (value.expected === 0) return null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-32 truncate">
                    {CATEGORY_LABELS[categoryKey]}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-charcoal overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getProgressColor(percentage)}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right">
                    {value.documented}/{value.expected}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Undocumented Items */}
          {coverage.undocumentedItems.length > 0 && (
            <div>
              <button
                onClick={() => setShowUndocumented(!showUndocumented)}
                className="flex items-center gap-2 text-sm text-amber-warning hover:text-amber-warning/80 transition-colors"
              >
                <AlertCircle className="w-4 h-4" />
                {coverage.undocumentedItems.length} missing document{coverage.undocumentedItems.length !== 1 ? 's' : ''}
                {showUndocumented ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showUndocumented && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {coverage.undocumentedItems.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 p-2 rounded-lg bg-charcoal/50 text-sm"
                    >
                      <FileText className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-300 font-mono text-xs">
                          {item.expectedDoc}
                        </p>
                        <p className="text-gray-500 text-xs">{item.suggestion}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
