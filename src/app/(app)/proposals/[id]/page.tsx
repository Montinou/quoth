'use client';

/**
 * Proposals Dashboard - Detail View
 * Shows proposal details with diff viewer and approve/reject actions
 */

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface Proposal {
  id: string;
  file_path: string;
  original_content: string;
  proposed_content: string;
  reasoning: string;
  evidence_snippet: string;
  status: string;
  created_at: string;
  commit_url?: string;
  rejection_reason?: string;
  reviewed_by?: string;
}

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { success, error: showError, warning } = useToast();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProposal();
  }, [id]);

  async function fetchProposal() {
    try {
      const res = await fetch(`/api/proposals/${id}`);
      if (!res.ok) throw new Error('Failed to fetch proposal');

      const data = await res.json();
      setProposal(data.proposal);
    } catch (err) {
      console.error('Error fetching proposal:', err);
      setError('Failed to load proposal');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!reviewerEmail) {
      warning('Please enter your email');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const res = await fetch(`/api/proposals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerEmail })
      });

      const data = await res.json();

      if (res.ok) {
        success('Proposal approved', 'Changes applied to knowledge base');
        router.push('/proposals');
      } else {
        setError(data.error || 'Failed to approve proposal');
        setProcessing(false);
      }
    } catch (err) {
      console.error('Error approving proposal:', err);
      setError('Failed to approve proposal');
      setProcessing(false);
    }
  }

  async function handleReject() {
    if (!reviewerEmail || !rejectReason) {
      warning('Please enter your email and rejection reason');
      return;
    }

    if (rejectReason.length < 10) {
      warning('Rejection reason must be at least 10 characters');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const res = await fetch(`/api/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerEmail, reason: rejectReason })
      });

      const data = await res.json();

      if (res.ok) {
        success('Proposal rejected');
        router.push('/proposals');
      } else {
        setError(data.error || 'Failed to reject proposal');
        setProcessing(false);
      }
    } catch (err) {
      console.error('Error rejecting proposal:', err);
      setError('Failed to reject proposal');
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 md:pt-8 flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-400">Loading proposal...</div>
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="px-6 py-8 md:pt-8">
        <div className="max-w-4xl mx-auto">
          <div className="glass-panel p-8 text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.push('/proposals')}
              className="text-violet-glow hover:text-violet-spectral"
            >
              ← Back to Proposals
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="px-6 py-8 md:pt-8">
        <div className="max-w-4xl mx-auto">
          <div className="glass-panel p-8 text-center">
            <p className="text-gray-400 mb-4">Proposal not found</p>
            <button
              onClick={() => router.push('/proposals')}
              className="text-violet-glow hover:text-violet-spectral"
            >
              ← Back to Proposals
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    approved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    applied: 'bg-green-500/10 text-green-400 border-green-500/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20'
  };

  return (
    <div className="px-6 py-8 md:pt-8">
      <div className="max-w-7xl mx-auto">
        <button
          onClick={() => router.back()}
          className="text-violet-glow hover:text-violet-spectral mb-6 inline-flex items-center gap-2"
        >
          <ArrowLeft size={18} />
          Back to Proposals
        </button>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="glass-panel p-8">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{proposal.file_path}</h1>
              <p className="text-sm text-gray-400">
                Created {new Date(proposal.created_at).toLocaleString()}
              </p>
              {proposal.reviewed_by && (
                <p className="text-sm text-gray-400">
                  Reviewed by {proposal.reviewed_by}
                </p>
              )}
            </div>
            <span className={`px-4 py-2 rounded-lg border ${statusColors[proposal.status]}`}>
              {proposal.status}
            </span>
          </div>

          {/* Reasoning */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">Reasoning</h2>
            <p className="text-gray-400">{proposal.reasoning}</p>
          </div>

          {/* Evidence */}
          {proposal.evidence_snippet && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white mb-2">Evidence</h2>
              <pre className="bg-charcoal p-4 rounded-lg overflow-x-auto text-sm text-gray-400">
                {proposal.evidence_snippet}
              </pre>
            </div>
          )}

          {/* Diff Viewer */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">Content Changes</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm text-red-400 mb-2 font-semibold">Original</h3>
                <pre className="bg-charcoal p-4 rounded-lg overflow-auto max-h-96 text-xs text-gray-400 whitespace-pre-wrap">
                  {proposal.original_content}
                </pre>
              </div>
              <div>
                <h3 className="text-sm text-green-400 mb-2 font-semibold">Proposed</h3>
                <pre className="bg-charcoal p-4 rounded-lg overflow-auto max-h-96 text-xs text-gray-400 whitespace-pre-wrap">
                  {proposal.proposed_content}
                </pre>
              </div>
            </div>
          </div>

          {/* Actions */}
          {proposal.status === 'pending' && (
            <div className="flex gap-4">
              <button
                onClick={() => setShowApproveDialog(true)}
                disabled={processing}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                ✓ Approve & Commit
              </button>
              <button
                onClick={() => setShowRejectDialog(true)}
                disabled={processing}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-900 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                ✗ Reject
              </button>
            </div>
          )}

          {proposal.status === 'applied' && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <p className="text-green-400">Changes applied to knowledge base. Previous version preserved in history.</p>
            </div>
          )}

          {proposal.status === 'rejected' && proposal.rejection_reason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold mb-2">Rejection Reason</h3>
              <p className="text-gray-400">{proposal.rejection_reason}</p>
            </div>
          )}

          {proposal.status === 'error' && proposal.rejection_reason && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold mb-2">Error</h3>
              <p className="text-gray-400">{proposal.rejection_reason}</p>
            </div>
          )}
        </div>

        {/* Approve Dialog */}
        {showApproveDialog && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass-panel p-8 max-w-md w-full">
              <h2 className="text-2xl font-bold text-white mb-4">Approve Proposal</h2>
              <p className="text-gray-400 mb-4">
                This will apply the changes to the knowledge base. Enter your email to confirm:
              </p>
              <input
                type="email"
                value={reviewerEmail}
                onChange={(e) => setReviewerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-charcoal text-white px-4 py-2 rounded-lg mb-4 border border-graphite focus:border-violet-spectral outline-none"
                disabled={processing}
              />
              <div className="flex gap-4">
                <button
                  onClick={handleApprove}
                  disabled={processing}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-900 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg flex-1 font-semibold"
                >
                  {processing ? 'Processing...' : 'Confirm Approval'}
                </button>
                <button
                  onClick={() => setShowApproveDialog(false)}
                  disabled={processing}
                  className="bg-charcoal hover:bg-charcoal/80 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reject Dialog */}
        {showRejectDialog && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass-panel p-8 max-w-md w-full">
              <h2 className="text-2xl font-bold text-white mb-4">Reject Proposal</h2>
              <input
                type="email"
                value={reviewerEmail}
                onChange={(e) => setReviewerEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-charcoal text-white px-4 py-2 rounded-lg mb-4 border border-graphite focus:border-violet-spectral outline-none"
                disabled={processing}
              />
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (minimum 10 characters)"
                className="w-full bg-charcoal text-white px-4 py-2 rounded-lg mb-4 h-24 border border-graphite focus:border-violet-spectral outline-none resize-none"
                disabled={processing}
              />
              <div className="flex gap-4">
                <button
                  onClick={handleReject}
                  disabled={processing}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-red-900 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg flex-1 font-semibold"
                >
                  {processing ? 'Processing...' : 'Confirm Rejection'}
                </button>
                <button
                  onClick={() => setShowRejectDialog(false)}
                  disabled={processing}
                  className="bg-charcoal hover:bg-charcoal/80 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
