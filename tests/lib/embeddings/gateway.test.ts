import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embed, embedMany } from 'ai';
import {
  generateEmbedding,
  generateEmbeddingsBatch,
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  isGatewayConfigured,
} from '@/lib/embeddings/gateway';

// ai module is mocked in tests/setup.ts
const mockEmbed = vi.mocked(embed);
const mockEmbedMany = vi.mocked(embedMany);

describe('gateway constants', () => {
  it('EMBEDDING_MODEL is voyage/voyage-4-lite', () => {
    expect(EMBEDDING_MODEL).toBe('voyage/voyage-4-lite');
  });

  it('EMBEDDING_DIMS is 1024', () => {
    expect(EMBEDDING_DIMS).toBe(1024);
  });
});

describe('generateEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue({
      embedding: new Array(1024).fill(0.1),
      usage: { tokens: 10 },
    } as never);
  });

  it('returns a 1024-dimensional vector', async () => {
    const result = await generateEmbedding('hello world');
    expect(result).toHaveLength(1024);
    expect(result[0]).toBe(0.1);
  });

  it('calls embed with cleaned text', async () => {
    await generateEmbedding('  hello\n\nworld  ');
    expect(mockEmbed).toHaveBeenCalledOnce();
    const callArgs = mockEmbed.mock.calls[0][0];
    expect(callArgs.value).toBe('hello world');
  });

  it('throws on empty input', async () => {
    await expect(generateEmbedding('')).rejects.toThrow(
      'Cannot generate embedding for empty text',
    );
  });

  it('throws on whitespace-only input', async () => {
    await expect(generateEmbedding('   \n\n  ')).rejects.toThrow(
      'Cannot generate embedding for empty text',
    );
  });

  it('trims whitespace before embedding', async () => {
    await generateEmbedding('  hello  ');
    const callArgs = mockEmbed.mock.calls[0][0];
    expect(callArgs.value).toBe('hello');
  });
});

describe('generateEmbeddingsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const result = await generateEmbeddingsBatch([]);
    expect(result).toEqual([]);
    expect(mockEmbedMany).not.toHaveBeenCalled();
  });

  it('returns zero vectors for all-empty strings', async () => {
    const result = await generateEmbeddingsBatch(['', '  ', '\n\n']);
    expect(result).toHaveLength(3);
    for (const vec of result) {
      expect(vec).toHaveLength(1024);
      expect(vec.every((v) => v === 0)).toBe(true);
    }
    expect(mockEmbedMany).not.toHaveBeenCalled();
  });

  it('embeds valid texts and maps zero vectors for empty strings', async () => {
    const fakeEmbedding1 = new Array(1024).fill(0.5);
    const fakeEmbedding2 = new Array(1024).fill(0.7);

    mockEmbedMany.mockResolvedValue({
      embeddings: [fakeEmbedding1, fakeEmbedding2],
      usage: { tokens: 20 },
    } as never);

    const result = await generateEmbeddingsBatch(['hello', '', 'world']);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(fakeEmbedding1);
    expect(result[1].every((v) => v === 0)).toBe(true); // zero vector for empty
    expect(result[2]).toBe(fakeEmbedding2);
  });

  it('batches at 2048 inputs', async () => {
    // Create 2050 valid texts to force 2 batches
    const texts = new Array(2050).fill('text');
    const batch1Embeddings = new Array(2048)
      .fill(null)
      .map(() => new Array(1024).fill(0.1));
    const batch2Embeddings = new Array(2)
      .fill(null)
      .map(() => new Array(1024).fill(0.2));

    mockEmbedMany
      .mockResolvedValueOnce({
        embeddings: batch1Embeddings,
        usage: { tokens: 100 },
      } as never)
      .mockResolvedValueOnce({
        embeddings: batch2Embeddings,
        usage: { tokens: 10 },
      } as never);

    const result = await generateEmbeddingsBatch(texts);

    expect(mockEmbedMany).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2050);

    // First 2048 from batch 1
    expect(result[0][0]).toBe(0.1);
    // Last 2 from batch 2
    expect(result[2048][0]).toBe(0.2);
  });

  it('maps results back to correct indices with mixed empty/valid', async () => {
    const e1 = new Array(1024).fill(1);
    const e2 = new Array(1024).fill(2);

    mockEmbedMany.mockResolvedValue({
      embeddings: [e1, e2],
      usage: { tokens: 10 },
    } as never);

    // indices: 0=empty, 1=valid, 2=empty, 3=valid, 4=empty
    const result = await generateEmbeddingsBatch(['', 'a', '', 'b', '']);

    expect(result).toHaveLength(5);
    expect(result[0].every((v) => v === 0)).toBe(true);
    expect(result[1]).toBe(e1);
    expect(result[2].every((v) => v === 0)).toBe(true);
    expect(result[3]).toBe(e2);
    expect(result[4].every((v) => v === 0)).toBe(true);
  });
});

describe('isGatewayConfigured', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns false when no keys set', () => {
    expect(isGatewayConfigured()).toBe(false);
  });

  it('returns true when AI_GATEWAY_API_KEY is set', () => {
    process.env.AI_GATEWAY_API_KEY = 'test';
    expect(isGatewayConfigured()).toBe(true);
  });

  it('returns true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'test';
    expect(isGatewayConfigured()).toBe(true);
  });
});
