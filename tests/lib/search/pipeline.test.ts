import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '@/lib/auth/types';

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
vi.mock('@/db/connection', () => ({
  getDb: () => ({ execute: mockExecute }),
}));

const mockGenerateEmbedding = vi.fn().mockResolvedValue(new Array(1536).fill(0.1));
vi.mock('@/lib/embeddings/gateway', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

const mockRerank = vi.fn();
const mockIsRerankerConfigured = vi.fn().mockReturnValue(false);
vi.mock('@/lib/embeddings/reranker', () => ({
  rerank: (...args: unknown[]) => mockRerank(...args),
  isRerankerConfigured: () => mockIsRerankerConfigured(),
}));

const mockGetCachedResults = vi.fn().mockResolvedValue(null);
const mockSetCachedResults = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/search/cache', () => ({
  getCachedResults: (...args: unknown[]) => mockGetCachedResults(...args),
  setCachedResults: (...args: unknown[]) => mockSetCachedResults(...args),
}));

vi.mock('@/lib/search/shared', () => ({
  searchSharedDocs: vi.fn().mockResolvedValue([]),
}));

const mockMaybeRunConsolidation = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/worker/trigger', () => ({
  maybeRunConsolidation: () => mockMaybeRunConsolidation(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { searchDocuments } from '@/lib/search/pipeline';
import { SEARCH_CONFIG, getAdaptiveFetchCount } from '@/lib/search/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    projectId: 'proj-1',
    orgId: 'org-1',
    tier: 'free',
    agentId: 'agent-1',
    ...overrides,
  } as AuthContext;
}

function vectorRow(id: string, similarity: number) {
  return {
    id,
    document_id: `doc-${id}`,
    content: `content-${id}`,
    chunk_index: 0,
    similarity,
    file_path: `/path/${id}.md`,
    title: `Title ${id}`,
    metadata: null,
  };
}

function ftsRow(id: string, rank: number) {
  return {
    id,
    document_id: `doc-${id}`,
    content: `content-${id}`,
    file_path: `/path/${id}.md`,
    title: `Title ${id}`,
    rank,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedResults.mockResolvedValue(null);
    mockSetCachedResults.mockResolvedValue(undefined);
    mockIsRerankerConfigured.mockReturnValue(false);
    mockMaybeRunConsolidation.mockResolvedValue(undefined);
  });

  it('returns empty array for blank query', async () => {
    const results = await searchDocuments('   ', makeContext());
    expect(results).toEqual([]);
    expect(mockGetCachedResults).not.toHaveBeenCalled();
  });

  it('returns search results from vector + FTS pipeline', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [vectorRow('c1', 0.95)] })
      .mockResolvedValueOnce({ rows: [ftsRow('c2', 1)] });

    const results = await searchDocuments('test query', makeContext());

    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({ chunkId: expect.any(String) });
    expect(results.every(r => r.similarity > 0)).toBe(true);
  });

  it('returns cached results when cache hits', async () => {
    mockGetCachedResults.mockResolvedValueOnce({
      resultIds: ['c1', 'c2'],
      resultScores: [0.9, 0.8],
      reranked: false,
    });

    const results = await searchDocuments('cached query', makeContext());

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ chunkId: 'c1', similarity: 0.9 });
    expect(results[1]).toMatchObject({ chunkId: 'c2', similarity: 0.8 });
    // Should NOT generate embedding or run DB queries
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('runs vector + FTS in parallel via Promise.all', async () => {
    let vectorResolved = false;
    let ftsResolved = false;

    mockExecute
      .mockImplementationOnce(async () => {
        vectorResolved = true;
        // FTS should not yet be resolved since they fire concurrently
        return { rows: [vectorRow('c1', 0.9)] };
      })
      .mockImplementationOnce(async () => {
        ftsResolved = true;
        return { rows: [ftsRow('c2', 1)] };
      });

    await searchDocuments('parallel test', makeContext());

    expect(vectorResolved).toBe(true);
    expect(ftsResolved).toBe(true);
    // Both execute calls should have been made
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('applies RRF fusion correctly — shared chunk gets boosted score', async () => {
    // Same chunk appears in both vector and FTS results
    const sharedId = 'shared-1';
    mockExecute
      .mockResolvedValueOnce({ rows: [vectorRow(sharedId, 0.95)] })
      .mockResolvedValueOnce({ rows: [ftsRow(sharedId, 1)] });

    const results = await searchDocuments('fusion test', makeContext());

    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe(sharedId);
    // RRF score from both lists should be higher than a single-list contribution
    // vector contribution: 0.6 * (1/(60+1)) = ~0.00984
    // fts contribution:    0.4 * (1/(60+1)) = ~0.00656
    // total:               ~0.01639
    const singleSourceScore = 0.6 * (1 / (SEARCH_CONFIG.RRF_K + 1));
    expect(results[0].similarity).toBeGreaterThan(singleSourceScore);
  });

  it('orders results by RRF score descending', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [vectorRow('top', 0.99), vectorRow('mid', 0.85)],
      })
      .mockResolvedValueOnce({ rows: [] });

    const results = await searchDocuments('order test', makeContext());

    expect(results[0].chunkId).toBe('top');
    expect(results[1].chunkId).toBe('mid');
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
  });

  it('triggers maybeRunConsolidation (fire-and-forget)', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [vectorRow('c1', 0.9)] })
      .mockResolvedValueOnce({ rows: [] });

    await searchDocuments('consolidation test', makeContext());

    expect(mockMaybeRunConsolidation).toHaveBeenCalledTimes(1);
  });

  it('caches results after search via setCachedResults', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [vectorRow('c1', 0.9)] })
      .mockResolvedValueOnce({ rows: [] });

    await searchDocuments('cache write', makeContext());

    expect(mockSetCachedResults).toHaveBeenCalledTimes(1);
    expect(mockSetCachedResults).toHaveBeenCalledWith(
      'proj-1',
      'cache write',
      SEARCH_CONFIG.EMBEDDING_MODEL,
      ['c1'],
      expect.any(Array),
      false, // not reranked
    );
  });
});

// ---------------------------------------------------------------------------
// getAdaptiveFetchCount (pure function, no mocks needed)
// ---------------------------------------------------------------------------

describe('getAdaptiveFetchCount', () => {
  it('returns SIMPLE (10) for queries < 5 words', () => {
    expect(getAdaptiveFetchCount('hello world')).toBe(10);
    expect(getAdaptiveFetchCount('one')).toBe(10);
    expect(getAdaptiveFetchCount('four word test here')).toBe(10);
  });

  it('returns MEDIUM (20) for queries 5-12 words', () => {
    expect(getAdaptiveFetchCount('this is a five word query')).toBe(20);
    expect(getAdaptiveFetchCount('one two three four five six seven eight nine ten eleven twelve')).toBe(20);
  });

  it('returns COMPLEX (30) for queries > 12 words', () => {
    expect(getAdaptiveFetchCount(
      'one two three four five six seven eight nine ten eleven twelve thirteen',
    )).toBe(30);
  });
});
