/**
 * Usage Analytics Dashboard Page
 * Displays MCP usage statistics and trends for the user's project
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { UsageAnalytics } from '@/components/dashboard/UsageAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Usage Analytics | Quoth Dashboard',
  description: 'View MCP usage statistics, search trends, and activity for your Quoth project.',
};

function AnalyticsSkeleton() {
  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header skeleton */}
        <div className="mb-10">
          <Skeleton className="h-6 w-32 mb-3 bg-graphite" />
          <Skeleton className="h-12 w-64 mb-3 bg-graphite" />
          <Skeleton className="h-5 w-96 bg-graphite" />
        </div>

        {/* Period selector skeleton */}
        <div className="flex gap-2 mb-8">
          <Skeleton className="h-10 w-20 bg-graphite" />
          <Skeleton className="h-10 w-20 bg-graphite" />
          <Skeleton className="h-10 w-20 bg-graphite" />
        </div>

        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-10">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-panel rounded-2xl p-6">
              <Skeleton className="h-4 w-24 mb-4 bg-graphite" />
              <Skeleton className="h-10 w-16 bg-graphite" />
            </div>
          ))}
        </div>

        {/* Top searches skeleton */}
        <div className="glass-panel rounded-2xl p-6 mb-10">
          <Skeleton className="h-6 w-40 mb-6 bg-graphite" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex justify-between items-center">
                <Skeleton className="h-5 w-48 bg-graphite" />
                <Skeleton className="h-5 w-12 bg-graphite" />
              </div>
            ))}
          </div>
        </div>

        {/* Timeline skeleton */}
        <div className="glass-panel rounded-2xl p-6">
          <Skeleton className="h-6 w-40 mb-4 bg-graphite" />
          <Skeleton className="h-64 w-full bg-graphite" />
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <UsageAnalytics />
    </Suspense>
  );
}
