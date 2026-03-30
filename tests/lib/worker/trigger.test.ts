import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Redis mock
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

const mockRedisInstance = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
};

vi.mock('@upstash/redis', () => {
  return {
    Redis: class {
      get = mockGet;
      set = mockSet;
      del = mockDel;
    },
  };
});

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockExecute = vi.fn().mockResolvedValue([{ affected: 0 }]);

vi.mock('@/db/connection', () => ({
  getDb: vi.fn(() => ({
    execute: mockExecute,
  })),
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => strings.join(''),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { maybeRunConsolidation } from '@/lib/worker/trigger';

describe('worker/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([{ affected: 0 }]);
    process.env.KV_REST_API_URL = 'https://test.upstash.io';
    process.env.KV_REST_API_TOKEN = 'test-token';
  });

  // -------------------------------------------------------------------------
  // maybeRunConsolidation
  // -------------------------------------------------------------------------
  describe('maybeRunConsolidation()', () => {
    it('runs when >1hr since last consolidation', async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      mockGet.mockResolvedValue(twoHoursAgo);
      mockSet.mockResolvedValue('OK');
      mockDel.mockResolvedValue(1);

      await maybeRunConsolidation();

      // Should acquire lock (SET NX)
      expect(mockSet).toHaveBeenCalledWith(
        'quoth:consolidation_lock',
        '1',
        { nx: true, ex: 120 },
      );
      // Should run the 3 SQL tasks
      expect(mockExecute).toHaveBeenCalledTimes(3);
      // Should update timestamp
      expect(mockSet).toHaveBeenCalledWith(
        'quoth:last_consolidation',
        expect.any(Number),
      );
      // Should release lock
      expect(mockDel).toHaveBeenCalledWith('quoth:consolidation_lock');
    });

    it('runs when no previous timestamp exists (first run)', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      mockDel.mockResolvedValue(1);

      await maybeRunConsolidation();

      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(mockDel).toHaveBeenCalledWith('quoth:consolidation_lock');
    });

    it('skips when <1hr since last consolidation', async () => {
      const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      mockGet.mockResolvedValue(thirtyMinAgo);

      await maybeRunConsolidation();

      // Should NOT attempt to acquire lock or run SQL
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('skips when lock already exists (another instance running)', async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      mockGet.mockResolvedValue(twoHoursAgo);
      // SET NX returns null when key already exists
      mockSet.mockResolvedValue(null);

      await maybeRunConsolidation();

      // Should have tried to acquire lock
      expect(mockSet).toHaveBeenCalledWith(
        'quoth:consolidation_lock',
        '1',
        { nx: true, ex: 120 },
      );
      // Should NOT run SQL tasks
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('releases lock in finally block even on error', async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      mockGet.mockResolvedValue(twoHoursAgo);
      mockSet.mockResolvedValue('OK');
      mockDel.mockResolvedValue(1);
      // All 3 SQL calls fail
      mockExecute.mockRejectedValue(new Error('SQL failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await maybeRunConsolidation();

      // Lock should still be released
      expect(mockDel).toHaveBeenCalledWith('quoth:consolidation_lock');
      errorSpy.mockRestore();
    });

    it('updates timestamp on success', async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      mockGet.mockResolvedValue(twoHoursAgo);
      mockSet.mockResolvedValue('OK');
      mockDel.mockResolvedValue(1);

      const before = Date.now();
      await maybeRunConsolidation();
      const after = Date.now();

      // Find the call that sets the timestamp (not the lock)
      const timestampCall = mockSet.mock.calls.find(
        (call: unknown[]) => call[0] === 'quoth:last_consolidation',
      );
      expect(timestampCall).toBeDefined();
      const savedTimestamp = timestampCall![1] as number;
      expect(savedTimestamp).toBeGreaterThanOrEqual(before);
      expect(savedTimestamp).toBeLessThanOrEqual(after);
    });

    it('does not throw even on unexpected errors (fire-and-forget)', async () => {
      mockGet.mockRejectedValue(new Error('Redis totally down'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(maybeRunConsolidation()).resolves.toBeUndefined();

      errorSpy.mockRestore();
    });
  });
});
