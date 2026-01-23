'use client';

/**
 * Proposals Dashboard - List View
 * Elegant display of documentation update proposals with filters and animations
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  GitPullRequest,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ArrowRight,
  Filter,
  Loader2,
} from 'lucide-react';

interface Proposal {
  id: string;
  file_path: string;
  reasoning: string;
  status: string;
  created_at: string;
  document_title: string;
}

const statusConfig: Record<string, {
  label: string;
  icon: typeof Clock;
  className: string;
  dotColor: string;
}> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'bg-amber-warning/15 text-amber-warning border-amber-warning/30',
    dotColor: 'bg-amber-warning',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    dotColor: 'bg-blue-400',
  },
  applied: {
    label: 'Applied',
    icon: CheckCircle2,
    className: 'bg-emerald-muted/15 text-emerald-muted border-emerald-muted/30',
    dotColor: 'bg-emerald-muted',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
    dotColor: 'bg-red-400',
  },
  error: {
    label: 'Error',
    icon: AlertCircle,
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
    dotColor: 'bg-red-400',
  },
};

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProposals();
  }, [filter]);

  async function fetchProposals() {
    setLoading(true);
    try {
      const url = filter === 'all'
        ? '/api/proposals'
        : `/api/proposals?status=${filter}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch proposals');

      const data = await res.json();
      setProposals(data.proposals || []);
    } catch (error) {
      console.error('Error fetching proposals:', error);
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }

  const statusCounts = proposals.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filters = ['all', 'pending', 'approved', 'applied', 'rejected', 'error'];

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-stagger stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <GitPullRequest className="w-5 h-5 text-violet-spectral" />
            </div>
            <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
              Review & Approve
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-3">
            Documentation Proposals
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Review and approve AI-proposed documentation updates. Each proposal includes reasoning and evidence.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
          {/* Total */}
          <div className="glass-panel stat-card rounded-2xl p-5 animate-stagger stagger-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Total</h3>
              <div className="p-2 rounded-lg bg-violet-spectral/15">
                <FileText className="w-4 h-4 text-violet-spectral" />
              </div>
            </div>
            <p className="text-3xl font-bold text-white stat-number">{proposals.length}</p>
          </div>

          {/* Pending */}
          <div className="glass-panel stat-card rounded-2xl p-5 animate-stagger stagger-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Pending</h3>
              <div className="p-2 rounded-lg bg-amber-warning/15">
                <Clock className="w-4 h-4 text-amber-warning" />
              </div>
            </div>
            <p className="text-3xl font-bold text-amber-warning stat-number">
              {statusCounts['pending'] || 0}
            </p>
          </div>

          {/* Applied */}
          <div className="glass-panel stat-card rounded-2xl p-5 animate-stagger stagger-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Applied</h3>
              <div className="p-2 rounded-lg bg-emerald-muted/15">
                <CheckCircle2 className="w-4 h-4 text-emerald-muted" />
              </div>
            </div>
            <p className="text-3xl font-bold text-emerald-muted stat-number">
              {statusCounts['applied'] || 0}
            </p>
          </div>

          {/* Rejected */}
          <div className="glass-panel stat-card rounded-2xl p-5 animate-stagger stagger-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Rejected</h3>
              <div className="p-2 rounded-lg bg-red-500/15">
                <XCircle className="w-4 h-4 text-red-400" />
              </div>
            </div>
            <p className="text-3xl font-bold text-red-400 stat-number">
              {statusCounts['rejected'] || 0}
            </p>
          </div>

          {/* Approved */}
          <div className="glass-panel stat-card rounded-2xl p-5 animate-stagger stagger-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Approved</h3>
              <div className="p-2 rounded-lg bg-blue-500/15">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
              </div>
            </div>
            <p className="text-3xl font-bold text-blue-400 stat-number">
              {statusCounts['approved'] || 0}
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mb-8 animate-stagger stagger-7">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-500 uppercase tracking-wider font-medium">Filter by status</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((status, index) => {
              const isActive = filter === status;
              const count = status === 'all' ? proposals.length : (statusCounts[status] || 0);
              return (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  data-active={isActive}
                  className={`
                    filter-tab px-4 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2
                    transition-all duration-300
                    ${isActive
                      ? 'bg-violet-spectral text-white shadow-lg shadow-violet-spectral/20'
                      : 'glass-panel text-gray-400 hover:text-white hover:bg-violet-spectral/10 hover:border-violet-spectral/30'
                    }
                  `}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  {status !== 'all' && statusConfig[status] && (
                    <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : statusConfig[status].dotColor}`} />
                  )}
                  <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
                  <span className={`
                    px-1.5 py-0.5 text-xs rounded-md
                    ${isActive ? 'bg-white/20' : 'bg-charcoal'}
                  `}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Proposals List */}
        {loading ? (
          <div className="glass-panel rounded-2xl p-12 text-center animate-content-reveal">
            <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4">
              <Loader2 className="w-8 h-8 text-violet-spectral spinner-glow" />
            </div>
            <p className="text-gray-400">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center animate-content-reveal">
            <div className="inline-flex p-4 rounded-2xl bg-charcoal mb-4 empty-state-icon">
              <GitPullRequest className="w-8 h-8 text-gray-500" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No proposals found</h3>
            <p className="text-gray-400 mb-4">
              {filter !== 'all'
                ? `No ${filter} proposals at the moment.`
                : 'Documentation update proposals will appear here when AI agents suggest changes.'}
            </p>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="text-violet-spectral hover:text-violet-glow transition-colors text-sm inline-flex items-center gap-2"
              >
                View all proposals
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal, index) => {
              const config = statusConfig[proposal.status] || statusConfig['pending'];
              const StatusIcon = config.icon;

              return (
                <Link
                  key={proposal.id}
                  href={`/proposals/${proposal.id}`}
                  className="glass-panel interactive-card rounded-2xl p-6 block group animate-stagger"
                  style={{ animationDelay: `${0.3 + index * 0.05}s` }}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-xl bg-violet-spectral/15 text-violet-spectral group-hover:bg-violet-spectral/25 transition-colors">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white group-hover:text-violet-ghost transition-colors mb-1">
                          {proposal.document_title || proposal.file_path}
                        </h3>
                        <code className="text-sm px-2 py-1 rounded-lg bg-charcoal/80 text-gray-400">
                          {proposal.file_path}
                        </code>
                      </div>
                    </div>
                    <span className={`
                      px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-2 shrink-0
                      ${config.className}
                    `}>
                      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} ${proposal.status === 'pending' ? 'animate-pulse' : ''}`} />
                      <StatusIcon className="w-3.5 h-3.5" />
                      {config.label}
                    </span>
                  </div>

                  <p className="text-gray-400 line-clamp-2 mb-4 pl-14">
                    {proposal.reasoning}
                  </p>

                  <div className="flex items-center justify-between pl-14">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      <span>Created {new Date(proposal.created_at).toLocaleDateString()} at {new Date(proposal.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-violet-spectral opacity-0 group-hover:opacity-100 transition-opacity">
                      <span>Review</span>
                      <ArrowRight className="w-4 h-4 action-arrow" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
