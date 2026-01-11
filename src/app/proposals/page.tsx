'use client';

/**
 * Proposals Dashboard - List View
 * Displays all documentation update proposals with filters
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Proposal {
  id: string;
  file_path: string;
  reasoning: string;
  status: string;
  created_at: string;
  document_title: string;
}

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

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    approved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    applied: 'bg-green-500/10 text-green-400 border-green-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20'
  };

  const statusCounts = proposals.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-obsidian text-graphite p-8">
      <div className="max-width mx-auto" style={{ maxWidth: '1400px' }}>
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-violet-glow font-serif">
            Documentation Proposals
          </h1>
          <p className="text-graphite">
            Review and approve AI-proposed documentation updates
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="glass-panel p-4">
            <div className="text-2xl font-bold text-white">
              {proposals.length}
            </div>
            <div className="text-sm text-graphite">Total</div>
          </div>
          <div className="glass-panel p-4">
            <div className="text-2xl font-bold text-yellow-400">
              {statusCounts['pending'] || 0}
            </div>
            <div className="text-sm text-graphite">Pending</div>
          </div>
          <div className="glass-panel p-4">
            <div className="text-2xl font-bold text-green-400">
              {statusCounts['applied'] || 0}
            </div>
            <div className="text-sm text-graphite">Applied</div>
          </div>
          <div className="glass-panel p-4">
            <div className="text-2xl font-bold text-red-400">
              {statusCounts['rejected'] || 0}
            </div>
            <div className="text-sm text-graphite">Rejected</div>
          </div>
          <div className="glass-panel p-4">
            <div className="text-2xl font-bold text-blue-400">
              {statusCounts['approved'] || 0}
            </div>
            <div className="text-sm text-graphite">Approved</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-4 mb-8">
          {['all', 'pending', 'approved', 'applied', 'rejected', 'error'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg transition-colors font-medium ${
                filter === status
                  ? 'bg-violet-spectral text-white'
                  : 'bg-charcoal text-graphite hover:bg-charcoal/80'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Proposals List */}
        {loading ? (
          <div className="glass-panel p-12 text-center">
            <div className="text-graphite">Loading proposals...</div>
          </div>
        ) : proposals.length === 0 ? (
          <div className="glass-panel p-12 text-center">
            <p className="text-graphite">No proposals found</p>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="mt-4 text-violet-glow hover:text-violet-spectral"
              >
                View all proposals
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map(proposal => (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="glass-panel p-6 block hover:border-violet-spectral/40 transition-all"
              >
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-xl font-semibold text-white">
                    {proposal.document_title || proposal.file_path}
                  </h3>
                  <span className={`px-3 py-1 rounded-full text-xs border ${statusColors[proposal.status]}`}>
                    {proposal.status}
                  </span>
                </div>
                <p className="text-sm text-graphite mb-2">
                  <code className="bg-charcoal px-2 py-1 rounded">{proposal.file_path}</code>
                </p>
                <p className="text-graphite line-clamp-2">
                  {proposal.reasoning}
                </p>
                <p className="text-xs text-graphite/60 mt-3">
                  Created {new Date(proposal.created_at).toLocaleString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
