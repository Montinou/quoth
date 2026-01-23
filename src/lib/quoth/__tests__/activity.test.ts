// src/lib/quoth/__tests__/activity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track mock return values
let mockReturnData: { data: unknown; error: unknown } = { data: [], error: null };

// Create a chainable mock that returns itself and resolves to mockReturnData
const createChainableMock = () => {
  const mock: Record<string, unknown> = {};

  // All chainable methods return the mock object itself
  mock.select = vi.fn().mockReturnValue(mock);
  mock.eq = vi.fn().mockReturnValue(mock);
  mock.gte = vi.fn().mockReturnValue(mock);
  mock.order = vi.fn().mockImplementation(() => Promise.resolve(mockReturnData));
  mock.insert = vi.fn().mockResolvedValue({ error: null });

  // For getTopMissedQueries which ends with .gte(), make it also resolvable
  // by adding .then() method to make it thenable
  mock.then = vi.fn().mockImplementation((resolve: (value: unknown) => void) => {
    return Promise.resolve(mockReturnData).then(resolve);
  });

  return mock;
};

// Mock the Supabase client before any imports
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => createChainableMock()),
  })),
}));

describe('miss rate analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to empty data
    mockReturnData = { data: [], error: null };
  });

  describe('getMissRateTrends', () => {
    it('should return miss rate trends structure with empty data', async () => {
      mockReturnData = { data: [], error: null };

      const { getMissRateTrends } = await import('../activity');
      const result = await getMissRateTrends('test-project', 7);

      expect(result).toHaveProperty('dailyMissRates');
      expect(result).toHaveProperty('averageMissRate');
      expect(result).toHaveProperty('trend');
      expect(['improving', 'stable', 'degrading']).toContain(result.trend);
      expect(Array.isArray(result.dailyMissRates)).toBe(true);
      expect(result.averageMissRate).toBe(0);
      expect(result.trend).toBe('stable');
    });

    it('should calculate miss rates by date', async () => {
      mockReturnData = {
        data: [
          { event_type: 'search', result_count: 0, created_at: '2025-01-20T10:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-20T11:00:00Z' },
          { event_type: 'search', result_count: 0, created_at: '2025-01-21T10:00:00Z' },
          { event_type: 'search', result_count: 3, created_at: '2025-01-21T11:00:00Z' },
          { event_type: 'search', result_count: 2, created_at: '2025-01-21T12:00:00Z' },
        ],
        error: null,
      };

      const { getMissRateTrends } = await import('../activity');
      const result = await getMissRateTrends('test-project', 7);

      expect(result.dailyMissRates.length).toBe(2);
      // Day 1: 1 miss out of 2 = 50%
      // Day 2: 1 miss out of 3 = 33%
      expect(result.dailyMissRates.find((d) => d.date === '2025-01-20')?.missRate).toBe(50);
      expect(result.dailyMissRates.find((d) => d.date === '2025-01-21')?.missRate).toBe(33);
    });

    it('should detect improving trend when later miss rates are lower', async () => {
      mockReturnData = {
        data: [
          // First half: high miss rate
          { event_type: 'search', result_count: 0, created_at: '2025-01-18T10:00:00Z' },
          { event_type: 'search', result_count: 0, created_at: '2025-01-18T11:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-18T12:00:00Z' },
          // Second half: low miss rate
          { event_type: 'search', result_count: 5, created_at: '2025-01-21T10:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-21T11:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-21T12:00:00Z' },
        ],
        error: null,
      };

      const { getMissRateTrends } = await import('../activity');
      const result = await getMissRateTrends('test-project', 7);

      expect(result.trend).toBe('improving');
    });

    it('should detect degrading trend when later miss rates are higher', async () => {
      mockReturnData = {
        data: [
          // First half: low miss rate
          { event_type: 'search', result_count: 5, created_at: '2025-01-18T10:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-18T11:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-18T12:00:00Z' },
          // Second half: high miss rate
          { event_type: 'search', result_count: 0, created_at: '2025-01-21T10:00:00Z' },
          { event_type: 'search', result_count: 0, created_at: '2025-01-21T11:00:00Z' },
          { event_type: 'search', result_count: 5, created_at: '2025-01-21T12:00:00Z' },
        ],
        error: null,
      };

      const { getMissRateTrends } = await import('../activity');
      const result = await getMissRateTrends('test-project', 7);

      expect(result.trend).toBe('degrading');
    });

    it('should handle database errors gracefully', async () => {
      mockReturnData = { data: null, error: { message: 'Database error' } };

      const { getMissRateTrends } = await import('../activity');
      const result = await getMissRateTrends('test-project', 7);

      expect(result.dailyMissRates).toEqual([]);
      expect(result.averageMissRate).toBe(0);
      expect(result.trend).toBe('stable');
    });
  });

  describe('getTopMissedQueries', () => {
    it('should return top missed queries structure with empty data', async () => {
      mockReturnData = { data: [], error: null };

      const { getTopMissedQueries } = await import('../activity');
      const result = await getTopMissedQueries('test-project', 10);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should aggregate and sort missed queries by count', async () => {
      mockReturnData = {
        data: [
          { query: 'authentication patterns', created_at: '2025-01-20T10:00:00Z' },
          { query: 'Authentication Patterns', created_at: '2025-01-20T11:00:00Z' }, // Same normalized
          { query: 'authentication patterns', created_at: '2025-01-21T10:00:00Z' },
          { query: 'error handling', created_at: '2025-01-20T10:00:00Z' },
          { query: 'error handling', created_at: '2025-01-21T11:00:00Z' },
          { query: 'deployment guide', created_at: '2025-01-20T10:00:00Z' },
        ],
        error: null,
      };

      const { getTopMissedQueries } = await import('../activity');
      const result = await getTopMissedQueries('test-project', 10);

      // Should be sorted by miss count descending
      expect(result.length).toBe(3);
      expect(result[0].query).toBe('authentication patterns');
      expect(result[0].missCount).toBe(3);
      expect(result[1].query).toBe('error handling');
      expect(result[1].missCount).toBe(2);
      expect(result[2].query).toBe('deployment guide');
      expect(result[2].missCount).toBe(1);
    });

    it('should respect the limit parameter', async () => {
      mockReturnData = {
        data: Array.from({ length: 20 }, (_, i) => ({
          query: `query ${i}`,
          created_at: '2025-01-20T10:00:00Z',
        })),
        error: null,
      };

      const { getTopMissedQueries } = await import('../activity');
      const result = await getTopMissedQueries('test-project', 5);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should handle database errors gracefully', async () => {
      mockReturnData = { data: null, error: { message: 'Database error' } };

      const { getTopMissedQueries } = await import('../activity');
      const result = await getTopMissedQueries('test-project', 10);

      expect(result).toEqual([]);
    });

    it('should normalize queries to lowercase', async () => {
      mockReturnData = {
        data: [
          { query: 'Test Query', created_at: '2025-01-20T10:00:00Z' },
          { query: 'TEST QUERY', created_at: '2025-01-20T11:00:00Z' },
          { query: 'test query', created_at: '2025-01-20T12:00:00Z' },
        ],
        error: null,
      };

      const { getTopMissedQueries } = await import('../activity');
      const result = await getTopMissedQueries('test-project', 10);

      // All three should be normalized to one entry
      expect(result.length).toBe(1);
      expect(result[0].query).toBe('test query');
      expect(result[0].missCount).toBe(3);
    });
  });
});
