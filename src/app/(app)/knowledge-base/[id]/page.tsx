'use client';

/**
 * Document Detail Page with Version History
 * View content with rollback functionality (admin only)
 */

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock, RotateCcw, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useToast } from '@/contexts/ToastContext';

interface DocumentVersion {
  id: string;
  version: number;
  content: string;
  archivedAt: string;
}

interface DocumentData {
  id: string;
  title: string;
  content: string;
  version: number;
  lastUpdated: string;
  path: string;
  history: DocumentVersion[];
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { success, error: showError } = useToast();
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    fetchDocument();
  }, [id]);

  const fetchDocument = async () => {
    try {
      const res = await fetch(`/api/knowledge-base/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load document');
        return;
      }
      setDoc(data);
    } catch (err) {
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async (historyId: string) => {
    if (!confirm('Restore this version? This will create a new version with the old content.')) return;
    setRollingBack(true);
    try {
      const res = await fetch(`/api/knowledge-base/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError('Rollback failed', data.error || 'Please try again');
        return;
      }
      await fetchDocument();
      setViewingVersion(null);
      success('Version restored', 'Document has been rolled back successfully');
    } catch {
      showError('Rollback failed', 'Please try again');
    } finally {
      setRollingBack(false);
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-8 md:pt-8 flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-400">Loading document...</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="px-6 py-8 md:pt-8">
        <div className="max-w-4xl mx-auto">
          <div className="glass-panel p-8 text-center">
            <p className="text-red-400 mb-4">{error || 'Document not found'}</p>
            <button
              onClick={() => router.push('/knowledge-base')}
              className="text-violet-glow hover:text-violet-spectral"
            >
              ← Back to Knowledge Base
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayContent = viewingVersion
    ? doc.history.find(h => h.version === viewingVersion)?.content || doc.content
    : doc.content;

  return (
    <div className="px-6 py-8 md:pt-8">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 mb-6 text-violet-glow hover:text-violet-spectral transition-colors"
        >
          <ArrowLeft size={18} /> Back
        </button>

        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">{doc.title}</h1>
            <p className="text-gray-400">{doc.path}</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-violet-spectral/20 text-violet-glow h-fit">
            Version {viewingVersion || doc.version}
          </span>
        </div>

        {/* History Toggle */}
        {doc.history.length > 0 && (
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-charcoal bg-charcoal/50 mb-6 hover:border-violet-spectral/50 transition-colors"
          >
            <Clock size={18} />
            History ({doc.history.length})
            <ChevronDown className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
        )}

        {showHistory && (
          <div className="border border-charcoal rounded-xl mb-6 overflow-hidden">
            {doc.history.map((v) => (
              <div key={v.id} className="flex justify-between items-center p-4 border-b border-charcoal last:border-0 bg-charcoal/30">
                <span className="text-white">
                  Version {v.version} - {new Date(v.archivedAt).toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingVersion(viewingVersion === v.version ? null : v.version)}
                    className="px-3 py-1 text-sm border border-charcoal rounded-lg hover:border-violet-spectral/50 transition-colors"
                  >
                    {viewingVersion === v.version ? 'Hide' : 'View'}
                  </button>
                  <button
                    onClick={() => handleRollback(v.id)}
                    disabled={rollingBack}
                    className="px-3 py-1 text-sm bg-violet-spectral hover:bg-violet-glow text-white rounded-lg flex items-center gap-1 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {viewingVersion && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-6">
            <p className="text-yellow-400">
              Viewing archived version {viewingVersion}. Current version is {doc.version}.
            </p>
          </div>
        )}

        <article className="prose prose-invert max-w-none bg-charcoal/30 rounded-xl p-8 border border-charcoal">
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
