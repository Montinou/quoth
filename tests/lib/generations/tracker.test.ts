import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
const mockLimit = vi.fn().mockResolvedValue([{ model: 'gpt-4o' }]);
const mockFrom = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

const mockDb = {
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
};

vi.mock('@/db/connection', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('@/db/schema', () => ({
  generations: {
    id: 'id',
    model: 'model',
    status: 'status',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => ({ col, val })),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-nano-id-123456789'),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  createGeneration,
  completeGeneration,
  failGeneration,
  streamGeneration,
  estimateCostCents,
  type GenerationUsage,
} from '@/lib/generations/tracker';

describe('generations/tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure DATABASE_URL is set so isDbConfigured() returns true
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';

    // Reset chainable mocks
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockLimit.mockResolvedValue([{ model: 'gpt-4o' }]);
    mockFrom.mockReturnValue({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  // -------------------------------------------------------------------------
  // createGeneration
  // -------------------------------------------------------------------------
  describe('createGeneration()', () => {
    it('creates with nanoid ID and status pending', async () => {
      const id = await createGeneration('gpt-4o', 'Hello world', 'user-1', 'proj-1');

      expect(id).toBe('test-nano-id-123456789');
      expect(mockDb.insert).toHaveBeenCalled();

      const valuesCall = mockInsert.mock.results[0].value.values;
      expect(valuesCall).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-nano-id-123456789',
          model: 'gpt-4o',
          status: 'pending',
          userId: 'user-1',
          projectId: 'proj-1',
        }),
      );
    });

    it('truncates prompt longer than 10KB', async () => {
      const longPrompt = 'x'.repeat(11_000);
      await createGeneration('gpt-4o', longPrompt);

      const valuesCall = mockInsert.mock.results[0].value.values;
      const passedValues = valuesCall.mock.calls[0][0];
      expect(passedValues.prompt.length).toBeLessThanOrEqual(10_004); // 10000 + '...'
      expect(passedValues.prompt.endsWith('...')).toBe(true);
    });

    it('returns ID even when DB insert fails', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('DB down')),
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const id = await createGeneration('gpt-4o', 'test');
      expect(id).toBe('test-nano-id-123456789');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GENERATIONS]'),
        expect.stringContaining('DB down'),
      );
      consoleSpy.mockRestore();
    });

    it('sets userId to null when not provided', async () => {
      await createGeneration('gpt-4o', 'test');

      const valuesCall = mockInsert.mock.results[0].value.values;
      expect(valuesCall).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // completeGeneration
  // -------------------------------------------------------------------------
  describe('completeGeneration()', () => {
    it('updates to complete with result, usage, and cost', async () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
      };

      await completeGeneration('gen-1', 'The answer is 42', usage);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'complete',
          result: 'The answer is 42',
          tokenUsage: usage,
        }),
      );
    });

    it('truncates result longer than 50KB', async () => {
      const longResult = 'y'.repeat(51_000);
      const usage: GenerationUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      };

      await completeGeneration('gen-1', longResult, usage);

      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.result.length).toBeLessThanOrEqual(50_004);
      expect(setCall.result.endsWith('...')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // failGeneration
  // -------------------------------------------------------------------------
  describe('failGeneration()', () => {
    it('updates to error status with error message in result', async () => {
      await failGeneration('gen-1', 'Rate limit exceeded');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          result: '[ERROR] Rate limit exceeded',
        }),
      );
    });

    it('truncates error message to 2000 chars', async () => {
      const longError = 'e'.repeat(3000);
      await failGeneration('gen-1', longError);

      const setCall = mockSet.mock.calls[0][0];
      // "[ERROR] " prefix (8 chars) + 2000 chars
      expect(setCall.result.length).toBeLessThanOrEqual(2008);
    });
  });

  // -------------------------------------------------------------------------
  // streamGeneration
  // -------------------------------------------------------------------------
  describe('streamGeneration()', () => {
    it('updates to streaming status', async () => {
      await streamGeneration('gen-1');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'streaming' }),
      );
    });

    it('is a no-op when DATABASE_URL not set', async () => {
      delete process.env.DATABASE_URL;

      await streamGeneration('gen-1');

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // estimateCostCents
  // -------------------------------------------------------------------------
  describe('estimateCostCents()', () => {
    it('calculates correct cost for gpt-4o', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
      };
      // gpt-4o: input $2.50/1M, output $10.00/1M => $12.50 => 1250 cents
      expect(estimateCostCents('gpt-4o', usage)).toBe(1250);
    });

    it('calculates correct cost for gpt-4o-mini', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
      };
      // gpt-4o-mini: input $0.15/1M, output $0.60/1M => $0.75 => 75 cents
      expect(estimateCostCents('gpt-4o-mini', usage)).toBe(75);
    });

    it('calculates correct cost for claude-sonnet-4-20250514', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
      };
      // claude-sonnet-4: input $3.00/1M, output $15.00/1M => $18.00 => 1800 cents
      expect(estimateCostCents('claude-sonnet-4-20250514', usage)).toBe(1800);
    });

    it('calculates correct cost for embedding model (output cost = 0)', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        total_tokens: 1_000_000,
      };
      // text-embedding-3-small: input $0.02/1M, output $0 => $0.02 => 2 cents
      expect(estimateCostCents('text-embedding-3-small', usage)).toBe(2);
    });

    it('returns 0 for unknown model', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
      };
      expect(estimateCostCents('unknown-model-xyz', usage)).toBe(0);
    });

    it('matches by prefix for versioned model names', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 1_000_000,
        completion_tokens: 1_000_000,
        total_tokens: 2_000_000,
      };
      // 'gemini-2.0-flash-exp' should match 'gemini-2.0-flash' prefix
      expect(estimateCostCents('gemini-2.0-flash-exp', usage)).toBe(38);
      // $0.075 + $0.30 = $0.375 => 37.5 => rounds to 38 cents
    });

    it('rounds cost to nearest integer cent', () => {
      const usage: GenerationUsage = {
        prompt_tokens: 500,
        completion_tokens: 500,
        total_tokens: 1000,
      };
      // gpt-4o: (500/1M)*$2.50 + (500/1M)*$10.00 = $0.00625 => 0.625 cents => rounds to 1
      expect(estimateCostCents('gpt-4o', usage)).toBe(1);
    });
  });
});
