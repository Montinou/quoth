import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Set env vars in vi.hoisted so they exist BEFORE any module loads
// ---------------------------------------------------------------------------
const mockCohereRerank = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  process.env.COHERE_API_KEY = 'test-cohere-key';
  process.env.JINA_API_KEY = 'test-jina-key';
});

// Mock cohere-ai — the factory is hoisted above the import
vi.mock('cohere-ai', () => {
  return {
    CohereClient: class MockCohereClient {
      rerank = mockCohereRerank;
    },
  };
});

// Stub global fetch for Jina calls
vi.stubGlobal('fetch', mockFetch);

// Now import the module under test
import { rerank, isRerankerConfigured } from '@/lib/embeddings/reranker';
import type { RerankDocument } from '@/lib/embeddings/reranker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocs(n: number): RerankDocument[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `doc-${i}`,
    text: `Document ${i} content`,
  }));
}

function makeCohereResults(scores: number[]) {
  return {
    results: scores.map((score, index) => ({
      index,
      relevanceScore: score,
    })),
  };
}

function makeJinaFetchResponse(scores: number[]) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      results: scores.map((score, index) => ({
        index,
        relevance_score: score,
      })),
    }),
    text: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rerank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty results for empty documents', async () => {
    const result = await rerank('query', []);
    expect(result).toEqual({ results: [], provider: 'cohere' });
    expect(mockCohereRerank).not.toHaveBeenCalled();
  });

  it('returns reranked results with scores from Cohere', async () => {
    const docs = makeDocs(3);
    mockCohereRerank.mockResolvedValue(
      makeCohereResults([0.95, 0.80, 0.70]),
    );

    const response = await rerank('test query', docs);

    expect(response.provider).toBe('cohere');
    expect(response.results).toHaveLength(3);
    expect(response.results[0].relevanceScore).toBe(0.95);
    expect(response.results[1].relevanceScore).toBe(0.80);
    expect(response.results[2].relevanceScore).toBe(0.70);
  });

  it('filters out results below minScore', async () => {
    const docs = makeDocs(5);
    mockCohereRerank.mockResolvedValue(
      makeCohereResults([0.9, 0.7, 0.6, 0.4, 0.3]),
    );

    const response = await rerank('query', docs, { minScore: 0.5 });

    // 0.4 and 0.3 are below minScore=0.5
    expect(response.results).toHaveLength(3);
    expect(response.results.every((r) => r.relevanceScore >= 0.5)).toBe(true);
  });

  describe('dynamic cutoff', () => {
    it('keeps at least minResults above minScore', async () => {
      // 12 results: first 10 above 0.65, next 2 between 0.5-0.65
      const scores = [
        0.95, 0.93, 0.90, 0.88, 0.85, 0.82, 0.80, 0.78, 0.75, 0.70, 0.60,
        0.55,
      ];
      const docs = makeDocs(scores.length);
      mockCohereRerank.mockResolvedValue(makeCohereResults(scores));

      const response = await rerank('query', docs, {
        minScore: 0.5,
        minResults: 10,
        highRelevanceThreshold: 0.65,
      });

      // First 10 are >= 0.65, then 0.60 < 0.65 triggers cutoff after minResults
      expect(response.results).toHaveLength(10);
    });

    it('stops below highRelevanceThreshold after minResults collected', async () => {
      const scores = [
        0.99, 0.95, 0.90, 0.88, 0.85, 0.82, 0.80, 0.78, 0.75, 0.70, 0.62,
        0.58, 0.55, 0.52, 0.51,
      ];
      const docs = makeDocs(scores.length);
      mockCohereRerank.mockResolvedValue(makeCohereResults(scores));

      const response = await rerank('query', docs, {
        minScore: 0.5,
        minResults: 10,
        highRelevanceThreshold: 0.65,
      });

      // After 10 results collected, 0.62 < 0.65 -> break
      expect(response.results).toHaveLength(10);
    });

    it('off-by-one fix: threshold checked BEFORE push', async () => {
      // Exactly minResults=2 above threshold, next one below
      const scores = [0.90, 0.80, 0.60];
      const docs = makeDocs(3);
      mockCohereRerank.mockResolvedValue(makeCohereResults(scores));

      const response = await rerank('query', docs, {
        minScore: 0.5,
        minResults: 2,
        highRelevanceThreshold: 0.65,
      });

      // After collecting 2 results (0.90, 0.80), check 0.60 < 0.65 -> break
      // The 0.60 result should NOT be included
      expect(response.results).toHaveLength(2);
      expect(response.results.map((r) => r.relevanceScore)).toEqual([
        0.90, 0.80,
      ]);
    });

    it('includes results below threshold while under minResults', async () => {
      // Scores that dip below highRelevanceThreshold but haven't hit minResults
      const scores = [0.90, 0.60, 0.55];
      const docs = makeDocs(3);
      mockCohereRerank.mockResolvedValue(makeCohereResults(scores));

      const response = await rerank('query', docs, {
        minScore: 0.5,
        minResults: 10,
        highRelevanceThreshold: 0.65,
      });

      // All 3 are above minScore=0.5 and we haven't reached minResults=10
      expect(response.results).toHaveLength(3);
    });
  });

  describe('timeout handling', () => {
    it('rejects Cohere after 10s timeout and falls back to Jina', async () => {
      // Cohere hangs forever
      mockCohereRerank.mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      // Jina succeeds
      mockFetch.mockResolvedValue(makeJinaFetchResponse([0.9, 0.8]));

      const docs = makeDocs(2);
      const promise = rerank('query', docs);

      // Advance past the 10s Cohere timeout
      await vi.advanceTimersByTimeAsync(10_001);

      const response = await promise;
      expect(response.provider).toBe('jina');
      expect(response.results).toHaveLength(2);
    });
  });

  describe('fallback behavior', () => {
    it('uses Jina when Cohere fails with an error', async () => {
      mockCohereRerank.mockRejectedValue(new Error('Cohere API down'));
      mockFetch.mockResolvedValue(makeJinaFetchResponse([0.85, 0.75, 0.65]));

      const docs = makeDocs(3);
      const response = await rerank('query', docs);

      expect(response.provider).toBe('jina');
      expect(response.results).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.jina.ai/v1/rerank',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws when both Cohere and Jina fail', async () => {
      mockCohereRerank.mockRejectedValue(new Error('Cohere down'));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });

      const docs = makeDocs(2);
      await expect(rerank('query', docs)).rejects.toThrow(
        'All reranking providers failed',
      );
    });
  });
});

describe('isRerankerConfigured', () => {
  it('returns true when COHERE_API_KEY is set', () => {
    expect(isRerankerConfigured()).toBe(true);
  });
});
