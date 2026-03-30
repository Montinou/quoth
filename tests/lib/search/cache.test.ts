import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();
vi.mock('@/db/connection', () => ({
  getDb: () => ({ execute: mockExecute }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  getCachedResults,
  setCachedResults,
  invalidateProjectCache,
  hashQuery,
} from '@/lib/search/cache';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hashQuery', () => {
  it('produces consistent hex hash for same inputs', () => {
    const h1 = hashQuery('proj-1', 'hello world', 'text-embedding-3-small');
    const h2 = hashQuery('proj-1', 'hello world', 'text-embedding-3-small');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes whitespace for higher hit rate', () => {
    const h1 = hashQuery('proj-1', 'hello   world', 'model');
    const h2 = hashQuery('proj-1', 'hello world', 'model');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different projects', () => {
    const h1 = hashQuery('proj-1', 'query', 'model');
    const h2 = hashQuery('proj-2', 'query', 'model');
    expect(h1).not.toBe(h2);
  });
});

describe('getCachedResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached entry when row exists', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        result_ids: ['c1', 'c2'],
        result_scores: [0.9, 0.8],
        reranked: true,
      }],
    });

    const result = await getCachedResults('proj-1', 'test query');

    expect(result).toEqual({
      resultIds: ['c1', 'c2'],
      resultScores: [0.9, 0.8],
      reranked: true,
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns null on cache miss (no rows)', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await getCachedResults('proj-1', 'unknown query');
    expect(result).toBeNull();
  });

  it('returns null when rows property is undefined', async () => {
    mockExecute.mockResolvedValueOnce({ rows: undefined });

    const result = await getCachedResults('proj-1', 'test');
    expect(result).toBeNull();
  });

  it('returns null and logs warning on DB error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(new Error('connection failed'));

    const result = await getCachedResults('proj-1', 'test');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[SEARCH_CACHE] Lookup failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe('setCachedResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts cache entry with hash key and TTL', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await setCachedResults(
      'proj-1',
      'some query',
      'text-embedding-3-small',
      ['c1', 'c2'],
      [0.9, 0.8],
      false,
      60,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    // The SQL template is opaque, but we can verify the call happened
  });

  it('handles DB errors gracefully (logs warning)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(new Error('write failed'));

    await setCachedResults('proj-1', 'query', 'model', ['c1'], [0.9]);

    expect(warnSpy).toHaveBeenCalledWith(
      '[SEARCH_CACHE] Set failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe('invalidateProjectCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes all cache entries for the project', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    await invalidateProjectCache('proj-1');

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('handles DB errors gracefully (logs warning)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(new Error('delete failed'));

    await invalidateProjectCache('proj-1');

    expect(warnSpy).toHaveBeenCalledWith(
      '[SEARCH_CACHE] Invalidation failed:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
