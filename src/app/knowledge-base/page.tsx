'use client';

/**
 * Knowledge Base Search Page
 * Semantic search UI with AI-powered answers using Gemini 2.0 Flash
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Clock, Sparkles, ChevronRight, Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface SearchResult {
  id: string;
  title: string;
  path: string;
  snippet: string;
  relevance: number;
  type: 'pattern' | 'architecture' | 'contract' | 'meta';
  version: number;
  lastUpdated: string;
}

interface Source {
  title: string;
  path: string;
}

interface AskResponse {
  aiAnswer: string | null;
  sources: Source[];
  relatedQuestions: string[];
  results: SearchResult[];
  aiEnabled: boolean;
}

export default function KnowledgeBasePage() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/knowledge-base/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Search failed');
        return;
      }

      setResponse(data);
    } catch (err) {
      console.error('Search failed:', err);
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRelatedQuestion = (question: string) => {
    setQuery(question);
    handleSearch(question);
  };

  return (
    <div className="min-h-screen bg-obsidian text-gray-400">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl font-bold text-white mb-2">Knowledge Base</h1>
        <p className="text-gray-400 mb-8">
          Ask questions about your documentation - powered by AI
        </p>

        {/* Search Input */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Ask a question or search documentation..."
            className="w-full pl-12 pr-32 py-4 rounded-xl border border-charcoal bg-charcoal text-white placeholder:text-gray-400 focus:border-violet-spectral outline-none"
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2
                       bg-violet-spectral hover:bg-violet-glow text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              'Thinking...'
            ) : (
              <>
                <Sparkles size={16} />
                Ask
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* AI Answer Section */}
        {response?.aiAnswer && (
          <div className="mb-8 rounded-xl border border-violet-spectral/30 bg-gradient-to-br from-violet-spectral/5 to-transparent overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-violet-spectral/20 flex items-center gap-3 bg-violet-spectral/10">
              <div className="p-2 rounded-lg bg-violet-spectral/20">
                <Sparkles className="text-violet-glow" size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-white">AI Answer</h2>
                <p className="text-xs text-gray-400">Powered by Gemini 2.0 Flash</p>
              </div>
            </div>

            {/* Answer Content */}
            <div className="p-6">
              <div className="prose prose-invert prose-violet max-w-none prose-p:text-gray-400 prose-headings:text-white prose-code:text-violet-glow prose-pre:bg-charcoal prose-pre:border prose-pre:border-charcoal">
                <ReactMarkdown>{response.aiAnswer}</ReactMarkdown>
              </div>

              {/* Sources */}
              {response.sources.length > 0 && (
                <div className="mt-6 pt-4 border-t border-charcoal">
                  <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Sources</p>
                  <div className="flex flex-wrap gap-2">
                    {response.sources.map((source, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const result = response.results.find(r => r.path === source.path);
                          if (result) router.push(`/knowledge-base/${result.id}`);
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg bg-charcoal hover:bg-charcoal/80 text-violet-glow border border-charcoal hover:border-violet-spectral/50 transition-colors flex items-center gap-1"
                      >
                        <FileText size={12} />
                        {source.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Questions */}
              {response.relatedQuestions.length > 0 && (
                <div className="mt-6 pt-4 border-t border-charcoal">
                  <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                    <Lightbulb size={12} />
                    Related Questions
                  </p>
                  <div className="space-y-2">
                    {response.relatedQuestions.map((question, i) => (
                      <button
                        key={i}
                        onClick={() => handleRelatedQuestion(question)}
                        className="w-full text-left px-4 py-3 rounded-lg bg-charcoal/50 hover:bg-charcoal text-white text-sm border border-transparent hover:border-violet-spectral/30 transition-all flex items-center justify-between group"
                      >
                        <span>{question}</span>
                        <ChevronRight
                          size={16}
                          className="text-gray-400 group-hover:text-violet-glow transition-colors"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Document Results Section */}
        {response && response.results.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">
              {response.aiAnswer ? 'Related Documents' : 'Search Results'} ({response.results.length})
            </h3>
          </div>
        )}

        {/* Results Grid */}
        <div className="grid gap-4">
          {response?.results.map((result) => (
            <div
              key={result.id}
              onClick={() => router.push(`/knowledge-base/${result.id}`)}
              className="p-6 rounded-xl border border-charcoal bg-charcoal/50 hover:bg-charcoal hover:border-violet-spectral/50 cursor-pointer transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="text-violet-spectral" />
                  <div>
                    <h3 className="font-semibold text-white">{result.title}</h3>
                    <p className="text-sm text-gray-400">{result.path}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="px-2 py-1 text-xs rounded-full bg-violet-spectral/20 text-violet-glow">
                    {Math.round(result.relevance * 100)}% match
                  </span>
                  {result.version && (
                    <span className="px-2 py-1 text-xs rounded-full bg-charcoal text-gray-400">
                      v{result.version}
                    </span>
                  )}
                </div>
              </div>
              {result.snippet && (
                <p className="mt-4 text-gray-400 line-clamp-2">{result.snippet}</p>
              )}
              {result.lastUpdated && (
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                  <Clock size={12} />
                  <span>{new Date(result.lastUpdated).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ))}

          {response && response.results.length === 0 && query && !loading && !error && (
            <div className="text-center py-12 text-gray-400">
              No results found for "{query}"
            </div>
          )}
        </div>

        {/* Empty State */}
        {!response && !loading && !error && (
          <div className="text-center py-16">
            <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4">
              <Sparkles className="text-violet-glow" size={32} />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Ask anything about your docs</h3>
            <p className="text-gray-400 max-w-md mx-auto">
              Get instant AI-powered answers based on your team's documentation.
              Try asking "How do I implement authentication?" or "What are our testing patterns?"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
