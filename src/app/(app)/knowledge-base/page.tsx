'use client';

/**
 * Knowledge Base Search Page
 * Semantic search UI with AI-powered answers using Gemini 2.0 Flash
 * Enhanced with smooth animations and intuitive interactions
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  FileText,
  Clock,
  Sparkles,
  ChevronRight,
  Lightbulb,
  BookOpen,
  Loader2,
  ArrowRight,
  Zap,
} from 'lucide-react';
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

const exampleQuestions = [
  'What are the testing patterns?',
  'How do I implement authentication?',
  'What is the API schema structure?',
  'How do I handle errors?',
];

export default function KnowledgeBasePage() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const router = useRouter();
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    // Cancel previous request if still in-flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new controller for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/knowledge-base/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
        signal: controller.signal,
      });

      // Check if aborted
      if (controller.signal.aborted) return;

      const data = await res.json();
      if (controller.signal.aborted) return;

      if (!res.ok) {
        setError(data.error || 'Search failed');
        return;
      }

      setResponse(data);
    } catch (err) {
      // Ignore AbortError - expected when user triggers new search
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Search failed:', err);
      setError('Search failed');
    } finally {
      // Only clear loading if not aborted
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleRelatedQuestion = (question: string) => {
    setQuery(question);
    handleSearch(question);
  };

  // Cleanup: abort in-flight request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-stagger stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <BookOpen className="w-5 h-5 text-violet-spectral" />
            </div>
            <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
              Search & Explore
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-3">
            Knowledge Base
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Ask questions about your documentation — powered by AI semantic search and Gemini 2.0 Flash.
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-10 animate-stagger stagger-2">
          <div
            className={`
              relative rounded-2xl transition-all duration-300
              ${isFocused
                ? 'ring-2 ring-violet-spectral/50 shadow-lg shadow-violet-spectral/10'
                : ''
              }
            `}
          >
            <Search
              className={`
                absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-300
                ${isFocused ? 'text-violet-spectral' : 'text-gray-500'}
              `}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Ask a question or search documentation..."
              className="w-full pl-14 pr-36 py-5 rounded-2xl border border-charcoal bg-charcoal/80 text-white placeholder:text-gray-500 focus:border-violet-spectral/50 outline-none transition-all duration-300 text-lg"
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-3
                         bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral
                         text-white rounded-xl font-semibold transition-all duration-300
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center gap-2 shadow-lg shadow-violet-spectral/20
                         hover:shadow-xl hover:shadow-violet-spectral/30 hover:scale-[1.02]
                         active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Thinking...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Ask</span>
                </>
              )}
            </button>
          </div>

          {/* Example Questions - Show when no query */}
          {!response && !loading && (
            <div className="mt-4 flex flex-wrap gap-2 animate-stagger stagger-3">
              <span className="text-sm text-gray-500">Try:</span>
              {exampleQuestions.map((q, i) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuery(q);
                    handleSearch(q);
                  }}
                  className="text-sm px-3 py-1.5 rounded-lg bg-charcoal/50 text-gray-400 hover:text-white hover:bg-violet-spectral/20 border border-transparent hover:border-violet-spectral/30 transition-all duration-200"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 mb-8 animate-stagger">
            <p className="text-red-400 flex items-center gap-2">
              <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
              {error}
            </p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="glass-panel rounded-2xl p-12 text-center mb-8 animate-content-reveal">
            <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4">
              <Loader2 className="w-8 h-8 text-violet-spectral spinner-glow" />
            </div>
            <p className="text-gray-400">Searching through documentation...</p>
            <div className="flex justify-center gap-1 mt-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-violet-spectral/40 rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI Answer Section */}
        {response?.aiAnswer && !loading && (
          <div className="mb-10 rounded-2xl border border-violet-spectral/30 bg-gradient-to-br from-violet-spectral/5 via-transparent to-violet-glow/5 overflow-hidden animate-content-reveal">
            {/* Header */}
            <div className="px-6 py-4 border-b border-violet-spectral/20 flex items-center gap-3 bg-gradient-to-r from-violet-spectral/10 to-transparent">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-spectral/30 to-violet-glow/20">
                <Zap className="text-violet-ghost w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">AI Answer</h2>
                <p className="text-xs text-gray-500">Powered by Gemini 2.0 Flash</p>
              </div>
            </div>

            {/* Answer Content */}
            <div className="p-6">
              <div className="prose prose-invert prose-violet max-w-none prose-p:text-gray-300 prose-headings:text-white prose-code:text-violet-ghost prose-pre:bg-charcoal/80 prose-pre:border prose-pre:border-charcoal prose-a:text-violet-spectral prose-strong:text-white">
                <ReactMarkdown>{response.aiAnswer}</ReactMarkdown>
              </div>

              {/* Sources */}
              {response.sources.length > 0 && (
                <div className="mt-6 pt-5 border-t border-charcoal/50">
                  <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider font-medium flex items-center gap-2">
                    <FileText className="w-3 h-3" />
                    Sources
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {response.sources.map((source, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          const result = response.results.find(r => r.path === source.path);
                          if (result) router.push(`/knowledge-base/${result.id}`);
                        }}
                        className="px-3 py-2 text-sm rounded-xl bg-charcoal/80 hover:bg-violet-spectral/20 text-violet-ghost border border-charcoal hover:border-violet-spectral/40 transition-all duration-200 flex items-center gap-2 group"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-500 group-hover:text-violet-spectral transition-colors" />
                        {source.title}
                        <ArrowRight className="w-3 h-3 text-gray-600 group-hover:text-violet-spectral transition-colors opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Related Questions */}
              {response.relatedQuestions.length > 0 && (
                <div className="mt-6 pt-5 border-t border-charcoal/50">
                  <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider font-medium flex items-center gap-2">
                    <Lightbulb className="w-3 h-3" />
                    Related Questions
                  </p>
                  <div className="space-y-2">
                    {response.relatedQuestions.map((question, i) => (
                      <button
                        key={i}
                        onClick={() => handleRelatedQuestion(question)}
                        className="w-full text-left px-4 py-3.5 rounded-xl bg-charcoal/50 hover:bg-violet-spectral/15 text-gray-300 text-sm border border-transparent hover:border-violet-spectral/30 transition-all duration-200 flex items-center justify-between group"
                      >
                        <span className="group-hover:text-white transition-colors">{question}</span>
                        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-violet-spectral transition-all group-hover:translate-x-1" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Document Results Section */}
        {response && response.results.length > 0 && !loading && (
          <div className="mb-6 animate-stagger stagger-4">
            <h3 className="text-sm text-gray-500 uppercase tracking-wider font-medium mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {response.aiAnswer ? 'Related Documents' : 'Search Results'} ({response.results.length})
            </h3>
          </div>
        )}

        {/* Results Grid */}
        {!loading && (
          <div className="grid gap-4">
            {response?.results.map((result, index) => (
              <div
                key={result.id}
                onClick={() => router.push(`/knowledge-base/${result.id}`)}
                className="glass-panel interactive-card rounded-2xl p-6 cursor-pointer group animate-stagger"
                style={{ animationDelay: `${0.3 + index * 0.05}s` }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-violet-spectral/15 text-violet-spectral group-hover:bg-violet-spectral/25 transition-colors">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1 group-hover:text-violet-ghost transition-colors">
                        {result.title}
                      </h3>
                      <p className="text-sm text-gray-500">{result.path}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-gradient-to-r from-violet-spectral/20 to-violet-glow/20 text-violet-ghost border border-violet-spectral/30">
                      {Math.round(result.relevance * 100)}% match
                    </span>
                    {result.version && (
                      <span className="px-2.5 py-1 text-xs rounded-full bg-charcoal text-gray-500">
                        v{result.version}
                      </span>
                    )}
                  </div>
                </div>
                {result.snippet && (
                  <p className="mt-4 text-gray-400 line-clamp-2 pl-14">{result.snippet}</p>
                )}
                {result.lastUpdated && (
                  <div className="mt-3 pl-14 flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>Updated {new Date(result.lastUpdated).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            ))}

            {response && response.results.length === 0 && query && !error && (
              <div className="glass-panel rounded-2xl p-12 text-center animate-content-reveal">
                <div className="inline-flex p-4 rounded-2xl bg-charcoal mb-4 empty-state-icon">
                  <Search className="w-8 h-8 text-gray-500" />
                </div>
                <p className="text-gray-400">No results found for "{query}"</p>
                <p className="text-sm text-gray-500 mt-2">Try a different search term or browse the documentation</p>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!response && !loading && !error && (
          <div className="text-center py-16 animate-stagger stagger-4">
            <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 mb-6 empty-state-icon">
              <Sparkles className="text-violet-spectral w-10 h-10" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">
              Ask anything about your docs
            </h3>
            <p className="text-gray-400 max-w-lg mx-auto text-lg">
              Get instant AI-powered answers based on your team's documentation.
              Our semantic search understands context and finds the most relevant information.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
