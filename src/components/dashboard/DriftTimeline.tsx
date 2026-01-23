'use client';

/**
 * Drift Timeline Component
 * Visualizes documentation drift events with severity indicators,
 * expandable details, and resolution capabilities
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileCode2,
  FileText,
  Clock,
  Filter,
  RefreshCw,
} from 'lucide-react';

// Types matching the API response
type DriftSeverity = 'info' | 'warning' | 'critical';
type DriftType = 'code_diverged' | 'missing_doc' | 'stale_doc' | 'pattern_violation';

interface DriftEvent {
  id: string;
  projectId: string;
  documentId?: string;
  severity: DriftSeverity;
  driftType: DriftType;
  filePath: string;
  docPath?: string;
  description: string;
  expectedPattern?: string;
  actualCode?: string;
  resolved: boolean;
  resolvedAt?: string;
  detectedAt: string;
}

interface DriftSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unresolvedCount: number;
}

interface DriftTimelineProps {
  projectId: string;
}

// Severity styling configuration
const severityConfig: Record<
  DriftSeverity,
  { bg: string; text: string; icon: typeof AlertTriangle; label: string }
> = {
  critical: {
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    icon: AlertTriangle,
    label: 'Critical',
  },
  warning: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    icon: AlertCircle,
    label: 'Warning',
  },
  info: {
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    icon: Info,
    label: 'Info',
  },
};

// Drift type labels
const driftTypeLabels: Record<DriftType, string> = {
  code_diverged: 'Code Diverged',
  missing_doc: 'Missing Doc',
  stale_doc: 'Stale Doc',
  pattern_violation: 'Pattern Violation',
};

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function DriftTimeline({ projectId }: DriftTimelineProps) {
  const [events, setEvents] = useState<DriftEvent[]>([]);
  const [summary, setSummary] = useState<DriftSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchDriftData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(
        `/api/projects/${projectId}/drift?includeResolved=${showResolved}`
      );
      if (!res.ok) throw new Error('Failed to fetch drift data');
      const data = await res.json();
      setEvents(data.timeline || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, showResolved]);

  useEffect(() => {
    fetchDriftData();
  }, [fetchDriftData]);

  const toggleExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const handleResolve = async (eventId: string) => {
    try {
      setResolvingId(eventId);
      const res = await fetch(`/api/projects/${projectId}/drift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', driftId: eventId }),
      });

      if (!res.ok) throw new Error('Failed to resolve drift');

      // Refresh data after resolving
      await fetchDriftData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setResolvingId(null);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-charcoal rounded-lg" />
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-charcoal rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
        <button
          onClick={fetchDriftData}
          className="glass-btn px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-spectral/15">
            <AlertCircle className="w-5 h-5 text-violet-spectral" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Drift Timeline</h3>
            <p className="text-sm text-gray-500">Documentation divergence events</p>
          </div>
        </div>

        <button
          onClick={fetchDriftData}
          className="p-2 rounded-lg hover:bg-charcoal/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="text-center p-3 rounded-lg bg-charcoal/50">
            <p className="text-2xl font-bold text-white">{summary.total}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-2xl font-bold text-red-400">{summary.critical}</p>
            <p className="text-xs text-red-400/70">Critical</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-2xl font-bold text-amber-400">{summary.warning}</p>
            <p className="text-xs text-amber-400/70">Warning</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-charcoal/50">
            <p className="text-2xl font-bold text-violet-ghost">
              {summary.unresolvedCount}
            </p>
            <p className="text-xs text-gray-500">Unresolved</p>
          </div>
        </div>
      )}

      {/* Filter Toggle */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm text-gray-400">Filter</span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-charcoal text-violet-spectral focus:ring-violet-spectral focus:ring-offset-0"
          />
          <span className="text-sm text-gray-400">Show resolved</span>
        </label>
      </div>

      {/* Timeline Events */}
      {events.length > 0 ? (
        <div className="space-y-3">
          {events.map((event) => {
            const config = severityConfig[event.severity];
            const SeverityIcon = config.icon;
            const isExpanded = expandedEvents.has(event.id);
            const isResolving = resolvingId === event.id;
            const hasDetails = event.expectedPattern || event.actualCode;

            return (
              <div
                key={event.id}
                className={`rounded-xl border transition-all ${
                  event.resolved
                    ? 'bg-charcoal/30 border-white/5 opacity-60'
                    : 'bg-charcoal/50 border-white/10'
                }`}
              >
                {/* Event Header */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Severity Icon */}
                    <div className={`p-2 rounded-lg ${config.bg} shrink-0`}>
                      <SeverityIcon className={`w-4 h-4 ${config.text}`} />
                    </div>

                    {/* Event Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {/* Severity Badge */}
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${config.bg} ${config.text}`}
                        >
                          {config.label}
                        </span>

                        {/* Drift Type Badge */}
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-graphite text-gray-400">
                          {driftTypeLabels[event.driftType]}
                        </span>

                        {/* Resolved Badge */}
                        {event.resolved && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Resolved
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-sm text-gray-300 mb-2">
                        {event.description}
                      </p>

                      {/* File Paths */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <div className="flex items-center gap-1 text-gray-500">
                          <FileCode2 className="w-3 h-3" />
                          <span className="truncate max-w-[200px]" title={event.filePath}>
                            {event.filePath}
                          </span>
                        </div>
                        {event.docPath && (
                          <div className="flex items-center gap-1 text-gray-500">
                            <FileText className="w-3 h-3" />
                            <span className="truncate max-w-[200px]" title={event.docPath}>
                              {event.docPath}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Side: Time & Actions */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(event.detectedAt)}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Expand Button */}
                        {hasDetails && (
                          <button
                            onClick={() => toggleExpanded(event.id)}
                            className="p-1.5 rounded hover:bg-white/5 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                          </button>
                        )}

                        {/* Resolve Button */}
                        {!event.resolved && (
                          <button
                            onClick={() => handleResolve(event.id)}
                            disabled={isResolving}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {isResolving ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Resolving...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                Resolve
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && hasDetails && (
                  <div className="px-4 pb-4 border-t border-white/5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      {/* Expected Pattern */}
                      {event.expectedPattern && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                            Expected Pattern
                          </p>
                          <pre className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300 overflow-x-auto font-mono whitespace-pre-wrap">
                            {event.expectedPattern}
                          </pre>
                        </div>
                      )}

                      {/* Actual Code */}
                      {event.actualCode && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                            Actual Code
                          </p>
                          <pre className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-300 overflow-x-auto font-mono whitespace-pre-wrap">
                            {event.actualCode}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8">
          <CheckCircle2 className="w-8 h-8 text-emerald-muted mx-auto mb-3" />
          <p className="text-gray-400">No drift events detected</p>
          <p className="text-sm text-gray-500">
            Your documentation is in sync with your code
          </p>
        </div>
      )}
    </div>
  );
}
