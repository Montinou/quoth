'use client';

/**
 * Usage Analytics Component
 * Displays MCP usage statistics with period selection, stat cards,
 * and integrated Phase 3 insight components (HealthDashboard, MissRateChart, DriftTimeline)
 */

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useProfile } from '@/contexts/AuthContext';
import {
  BarChart3,
  Search,
  FileText,
  TrendingUp,
  Activity,
} from 'lucide-react';

// Phase 3 Insight Components
import { HealthDashboard } from './HealthDashboard';
import { MissRateChart } from './MissRateChart';
import { DriftTimeline } from './DriftTimeline';

type Period = '7d' | '30d' | '90d';

interface UsageStats {
  totalQueries: number;
  byEventType: Record<string, number>;
  queriesPerDay: Record<string, number>;
  topSearches: { query: string; count: number }[];
  avgResultsPerSearch: number;
}

export function UsageAnalytics() {
  const { profile } = useProfile();
  const { getToken } = useAuth();
  const [period, setPeriod] = useState<Period>('7d');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      if (!profile?.defaultProjectId) {
        setLoading(false);
        return;
      }

      const authToken = await getToken();
      if (!authToken) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/analytics/usage?project_id=${profile.defaultProjectId}&period=${period}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to fetch analytics');
        }

        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error('[UsageAnalytics] Error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [profile?.defaultProjectId, getToken, period]);

  const periodLabels: Record<Period, string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
  };

  // Stat cards configuration
  const statCards = [
    {
      label: 'Total Queries',
      value: stats?.totalQueries ?? 0,
      icon: BarChart3,
      color: 'violet',
    },
    {
      label: 'Searches',
      value: stats?.byEventType?.search ?? 0,
      icon: Search,
      color: 'blue',
    },
    {
      label: 'Doc Reads',
      value: stats?.byEventType?.read ?? 0,
      icon: FileText,
      color: 'emerald',
    },
    {
      label: 'Avg Results/Search',
      value: stats?.avgResultsPerSearch ?? 0,
      icon: TrendingUp,
      color: 'amber',
    },
  ];

  // No project available
  if (!profile?.defaultProjectId) {
    return (
      <div className="px-6 py-8 md:py-10">
        <div className="max-w-7xl mx-auto">
          <div className="glass-panel rounded-2xl p-12 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4">
              <Activity className="w-8 h-8 text-violet-spectral" strokeWidth={1.5} />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No Project Found</h3>
            <p className="text-gray-400">
              Your default project will be created automatically after email verification.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <Activity className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
            </div>
            <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
              Analytics
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel mb-3 text-white">
            Usage Analytics
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Track how your knowledge base is being used by AI agents through MCP.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-2 mb-8">
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300
                ${
                  period === p
                    ? 'bg-violet-spectral text-white'
                    : 'bg-graphite text-gray-400 hover:text-white hover:bg-charcoal'
                }
              `}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>

        {/* Error State */}
        {error && (
          <div className="glass-panel rounded-2xl p-6 mb-8 border border-red-500/30 bg-red-500/10">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-gray-400">
              <div className="w-5 h-5 border-2 border-violet-spectral border-t-transparent rounded-full animate-spin" />
              <span>Loading analytics...</span>
            </div>
          </div>
        )}

        {/* Stats Display */}
        {!loading && stats && (
          <>
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-10">
              {statCards.map((stat, index) => (
                <StatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  icon={stat.icon}
                  color={stat.color}
                  index={index}
                />
              ))}
            </div>

            {/* Phase 3 Insights: Health Dashboard & Miss Rate Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
              <Suspense fallback={<InsightCardSkeleton />}>
                <HealthDashboard projectId={profile.defaultProjectId} />
              </Suspense>
              <Suspense fallback={<InsightCardSkeleton />}>
                <MissRateChart projectId={profile.defaultProjectId} />
              </Suspense>
            </div>

            {/* Top Searches */}
            <div className="glass-panel rounded-2xl p-6 mb-10">
              <div className="flex items-center gap-3 mb-6">
                <Search className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
                <h2 className="text-xl font-bold text-white">Top Searches</h2>
              </div>

              {stats.topSearches.length > 0 ? (
                <div className="space-y-3">
                  {stats.topSearches.map((search, index) => (
                    <div
                      key={search.query}
                      className="flex items-center gap-4 py-3 px-4 bg-charcoal/50 rounded-lg border border-graphite hover:border-violet-spectral/30 transition-colors"
                    >
                      <span className="text-sm text-violet-ghost font-medium shrink-0">
                        #{index + 1}
                      </span>
                      <span className="text-gray-400 truncate flex-1 min-w-0">{search.query}</span>
                      <span className="text-white font-medium bg-violet-spectral/20 px-3 py-1 rounded-full text-sm shrink-0">
                        {search.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-400">No search queries recorded yet</p>
                </div>
              )}
            </div>

            {/* Phase 3 Insights: Drift Timeline (Full Width) */}
            <Suspense fallback={<DriftTimelineSkeleton />}>
              <DriftTimeline projectId={profile.defaultProjectId} />
            </Suspense>
          </>
        )}

        {/* Empty State */}
        {!loading && stats && stats.totalQueries === 0 && (
          <div className="glass-panel rounded-2xl p-12 text-center mt-8">
            <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4">
              <Activity className="w-8 h-8 text-violet-spectral" strokeWidth={1.5} />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No Activity Yet</h3>
            <p className="text-gray-400 max-w-md mx-auto">
              Start using Quoth MCP tools to see your usage analytics here.
              Connect Claude Desktop or other MCP clients to begin.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * StatCard Component
 * Displays a single stat card with icon, label, and value
 */
interface StatCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  color: string;
  index: number;
}

function StatCard({ label, value, icon: Icon, color, index }: StatCardProps) {
  return (
    <div
      className="glass-panel rounded-2xl p-6 animate-stagger"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">{label}</h3>
        <div
          className={`
            p-2 rounded-lg transition-all duration-300
            ${color === 'violet' ? 'bg-violet-spectral/15 text-violet-spectral' : ''}
            ${color === 'blue' ? 'bg-blue-500/15 text-blue-400' : ''}
            ${color === 'emerald' ? 'bg-emerald-muted/15 text-emerald-muted' : ''}
            ${color === 'amber' ? 'bg-amber-warning/15 text-amber-warning' : ''}
          `}
        >
          <Icon className="w-5 h-5" strokeWidth={1.5} />
        </div>
      </div>
      <p className="text-3xl md:text-4xl font-bold text-white">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * InsightCardSkeleton Component
 * Loading skeleton for HealthDashboard and MissRateChart components
 */
function InsightCardSkeleton() {
  return (
    <div className="glass-panel rounded-2xl p-6 animate-pulse">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-charcoal rounded-xl" />
        <div>
          <div className="h-5 w-40 bg-charcoal rounded mb-2" />
          <div className="h-4 w-24 bg-charcoal rounded" />
        </div>
      </div>
      <div className="flex gap-6 mb-6">
        <div className="h-32 w-32 bg-charcoal rounded-full shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-4 bg-charcoal rounded w-3/4" />
          <div className="h-6 bg-charcoal rounded" />
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-charcoal rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * DriftTimelineSkeleton Component
 * Loading skeleton for DriftTimeline component
 */
function DriftTimelineSkeleton() {
  return (
    <div className="glass-panel rounded-2xl p-6 animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-charcoal rounded-xl" />
          <div>
            <div className="h-5 w-32 bg-charcoal rounded mb-2" />
            <div className="h-4 w-48 bg-charcoal rounded" />
          </div>
        </div>
        <div className="w-8 h-8 bg-charcoal rounded-lg" />
      </div>
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-charcoal rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-charcoal rounded-xl" />
        ))}
      </div>
    </div>
  );
}
