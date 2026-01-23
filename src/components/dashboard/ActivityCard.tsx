'use client';

/**
 * Activity Card Component
 * Displays usage analytics for Quoth tools
 */

import { useState, useEffect } from 'react';
import { Activity, Search, FileText, GitPullRequest, TrendingUp } from 'lucide-react';

interface ActivitySummary {
  totalQueries: number;
  searchCount: number;
  readCount: number;
  proposeCount: number;
  topSearchTerms: Array<{ query: string; count: number }>;
  missRate: number;
}

interface ActivityCardProps {
  projectId: string;
}

export function ActivityCard({ projectId }: ActivityCardProps) {
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch(`/api/projects/${projectId}/activity`);
        if (!res.ok) throw new Error('Failed to fetch activity');
        const data = await res.json();
        setActivity(data.activity);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchActivity();
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="h-20 bg-charcoal rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-blue-500/15">
          <Activity className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Usage Analytics</h3>
          <p className="text-sm text-gray-500">Last 7 days</p>
        </div>
      </div>

      {activity ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-3 rounded-lg bg-charcoal/50">
              <Search className="w-5 h-5 text-violet-spectral mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{activity.searchCount}</p>
              <p className="text-xs text-gray-500">Searches</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-charcoal/50">
              <FileText className="w-5 h-5 text-emerald-muted mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{activity.readCount}</p>
              <p className="text-xs text-gray-500">Reads</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-charcoal/50">
              <GitPullRequest className="w-5 h-5 text-amber-warning mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{activity.proposeCount}</p>
              <p className="text-xs text-gray-500">Proposals</p>
            </div>
          </div>

          {/* Miss Rate */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Search Miss Rate</span>
              <span className={`text-sm font-medium ${
                activity.missRate > 30 ? 'text-amber-warning' : 'text-emerald-muted'
              }`}>
                {activity.missRate}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-charcoal overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  activity.missRate > 30 ? 'bg-amber-warning' : 'bg-emerald-muted'
                }`}
                style={{ width: `${Math.min(activity.missRate, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Searches with no results (gaps in documentation)
            </p>
          </div>

          {/* Top Search Terms */}
          {activity.topSearchTerms.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-400">Top Searches</span>
              </div>
              <div className="space-y-2">
                {activity.topSearchTerms.slice(0, 5).map((term, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-300 truncate max-w-[200px]">
                      {term.query}
                    </span>
                    <span className="text-gray-500">{term.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-6">
          <Activity className="w-8 h-8 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No activity data yet</p>
          <p className="text-sm text-gray-500">
            Start using Quoth tools to see analytics
          </p>
        </div>
      )}
    </div>
  );
}
