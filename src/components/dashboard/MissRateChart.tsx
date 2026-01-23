'use client';

/**
 * Miss Rate Chart Component
 * Visualizes search miss rate trends over time
 */

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Search, HelpCircle } from 'lucide-react';

interface MissRateTrends {
  dailyMissRates: Array<{ date: string; missRate: number; searchCount: number }>;
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface TopMissedQuery {
  query: string;
  missCount: number;
  lastMissed: string;
}

interface MissRateChartProps {
  projectId: string;
}

export function MissRateChart({ projectId }: MissRateChartProps) {
  const [trends, setTrends] = useState<MissRateTrends | null>(null);
  const [topMissed, setTopMissed] = useState<TopMissedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/analytics/miss-rate?project_id=${projectId}&period=7d`);
        if (!res.ok) throw new Error('Failed to fetch miss rate data');
        const data = await res.json();
        setTrends(data.trends);
        setTopMissed(data.topMissed || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  const getTrendIcon = () => {
    if (!trends) return null;
    switch (trends.trend) {
      case 'improving':
        return <TrendingDown className="w-5 h-5 text-emerald-400" />;
      case 'degrading':
        return <TrendingUp className="w-5 h-5 text-red-400" />;
      default:
        return <Minus className="w-5 h-5 text-gray-400" />;
    }
  };

  const getTrendText = () => {
    if (!trends) return '';
    switch (trends.trend) {
      case 'improving':
        return 'Improving';
      case 'degrading':
        return 'Needs attention';
      default:
        return 'Stable';
    }
  };

  const getTrendColor = () => {
    if (!trends) return 'text-gray-400';
    switch (trends.trend) {
      case 'improving':
        return 'text-emerald-400';
      case 'degrading':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const maxRate = trends
    ? Math.max(...trends.dailyMissRates.map((d) => d.missRate), 10)
    : 100;

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="h-32 bg-charcoal rounded" />
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-spectral/15">
            <Search className="w-5 h-5 text-violet-spectral" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Search Miss Rate</h3>
            <p className="text-sm text-gray-500">Last 7 days</p>
          </div>
        </div>

        {trends && (
          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <span className={`text-sm ${getTrendColor()}`}>{getTrendText()}</span>
          </div>
        )}
      </div>

      {trends && trends.dailyMissRates.length > 0 ? (
        <>
          {/* Average Rate */}
          <div className="text-center mb-6">
            <p className={`text-4xl font-bold ${
              trends.averageMissRate > 30 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {trends.averageMissRate}%
            </p>
            <p className="text-sm text-gray-500">Average miss rate</p>
          </div>

          {/* Simple Bar Chart */}
          <div className="mb-6">
            <div className="flex items-end justify-between gap-1 h-24">
              {trends.dailyMissRates.map((day, index) => {
                const height = (day.missRate / maxRate) * 100;
                const isHigh = day.missRate > 30;
                return (
                  <div
                    key={index}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <div
                      className={`w-full rounded-t transition-all ${
                        isHigh ? 'bg-amber-400' : 'bg-violet-spectral'
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${day.date}: ${day.missRate}% (${day.searchCount} searches)`}
                    />
                    <span className="text-[10px] text-gray-500">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Missed Queries */}
          {topMissed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-400">
                  Top queries with no results
                </span>
              </div>
              <div className="space-y-2">
                {topMissed.slice(0, 5).map((query, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm p-2 rounded bg-charcoal/50"
                  >
                    <span className="text-gray-300 truncate max-w-[200px]">
                      &quot;{query.query}&quot;
                    </span>
                    <span className="text-amber-400 shrink-0 ml-2">
                      {query.missCount}x missed
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Consider documenting these topics to reduce miss rate
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Search className="w-8 h-8 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No search data yet</p>
          <p className="text-sm text-gray-500">
            Start using Quoth search to see analytics
          </p>
        </div>
      )}
    </div>
  );
}
