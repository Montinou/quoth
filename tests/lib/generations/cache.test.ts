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
// Import after mocks
// ---------------------------------------------------------------------------

import {
  hashPrompt,
  getCachedGeneration,
  setCachedGeneration,
  invalidateCachedGeneration,
} from '@/lib/generations/cache';

describe('generations/cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
    process.env.KV_REST_API_URL = 'https://test.upstash.io';
    process.env.KV_REST_API_TOKEN = 'test-token';
  });

  // -------------------------------------------------------------------------
  // hashPrompt
  // -------------------------------------------------------------------------
  describe('hashPrompt()', () => {
    it('returns consistent hash for same input', () => {
      const h1 = hashPrompt('gpt-4o', 'Hello world');
      const h2 = hashPrompt('gpt-4o', 'Hello world');
      expect(h1).toBe(h2);
    });

    it('returns different hash for different models', () => {
      const h1 = hashPrompt('gpt-4o', 'Hello world');
      const h2 = hashPrompt('gpt-4o-mini', 'Hello world');
      expect(h1).not.toBe(h2);
    });

    it('returns different hash for different prompts', () => {
      const h1 = hashPrompt('gpt-4o', 'Hello world');
      const h2 = hashPrompt('gpt-4o', 'Goodbye world');
      expect(h1).not.toBe(h2);
    });

    it('normalizes whitespace before hashing', () => {
      const h1 = hashPrompt('gpt-4o', 'Hello   world');
      const h2 = hashPrompt('gpt-4o', 'Hello world');
      expect(h1).toBe(h2);
    });

    it('trims leading/trailing whitespace before hashing', () => {
      const h1 = hashPrompt('gpt-4o', '  Hello world  ');
      const h2 = hashPrompt('gpt-4o', 'Hello world');
      expect(h1).toBe(h2);
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const hash = hashPrompt('gpt-4o', 'test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // -------------------------------------------------------------------------
  // getCachedGeneration
  // -------------------------------------------------------------------------
  describe('getCachedGeneration()', () => {
    it('returns cached generation ID from Redis', async () => {
      mockGet.mockResolvedValue('gen-abc-123');

      const result = await getCachedGeneration('gpt-4o', 'Hello world');
      expect(result).toBe('gen-abc-123');
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('gen:dedup:'),
      );
    });

    it('returns null on cache miss', async () => {
      mockGet.mockResolvedValue(null);

      const result = await getCachedGeneration('gpt-4o', 'unknown prompt');
      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockGet.mockRejectedValue(new Error('Redis timeout'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await getCachedGeneration('gpt-4o', 'test');
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GEN_CACHE]'),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // setCachedGeneration
  // -------------------------------------------------------------------------
  describe('setCachedGeneration()', () => {
    it('stores generation ID with default TTL', async () => {
      mockSet.mockResolvedValue('OK');

      await setCachedGeneration('gpt-4o', 'Hello world', 'gen-abc-123');

      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('gen:dedup:'),
        'gen-abc-123',
        { ex: 3600 },
      );
    });

    it('stores generation ID with custom TTL', async () => {
      mockSet.mockResolvedValue('OK');

      await setCachedGeneration('gpt-4o', 'Hello world', 'gen-abc-123', 7200);

      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('gen:dedup:'),
        'gen-abc-123',
        { ex: 7200 },
      );
    });

    it('uses consistent key based on hashPrompt', async () => {
      mockSet.mockResolvedValue('OK');

      const expectedKey = 'gen:dedup:' + hashPrompt('gpt-4o', 'Hello world');
      await setCachedGeneration('gpt-4o', 'Hello world', 'gen-1');

      expect(mockSet).toHaveBeenCalledWith(expectedKey, 'gen-1', { ex: 3600 });
    });

    it('does not throw on Redis error', async () => {
      mockSet.mockRejectedValue(new Error('Redis write fail'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        setCachedGeneration('gpt-4o', 'test', 'gen-1'),
      ).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // invalidateCachedGeneration
  // -------------------------------------------------------------------------
  describe('invalidateCachedGeneration()', () => {
    it('deletes from Redis using correct key', async () => {
      mockDel.mockResolvedValue(1);

      const expectedKey = 'gen:dedup:' + hashPrompt('gpt-4o', 'Hello world');
      await invalidateCachedGeneration('gpt-4o', 'Hello world');

      expect(mockDel).toHaveBeenCalledWith(expectedKey);
    });

    it('does not throw on Redis error', async () => {
      mockDel.mockRejectedValue(new Error('Redis delete fail'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        invalidateCachedGeneration('gpt-4o', 'test'),
      ).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });
  });
});
