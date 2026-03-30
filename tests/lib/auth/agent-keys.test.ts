/**
 * Tests for src/lib/auth/agent-keys.ts
 *
 * Covers: generateAgentApiKey, verifyAgentApiKey, revokeApiKey, rotateApiKey
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { getDb } from '@/db/connection';
import {
  generateAgentApiKey,
  verifyAgentApiKey,
  revokeApiKey,
  rotateApiKey,
} from '@/lib/auth/agent-keys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a chainable DB mock. Each method returns `this` except terminal ones. */
function createDbMock(returnData: unknown[] = []) {
  const mock: Record<string, ReturnType<typeof vi.fn>> = {};

  // Terminal methods resolve the chain
  mock.returning = vi.fn().mockResolvedValue(returnData);
  mock.limit = vi.fn().mockResolvedValue(returnData);
  mock.then = vi.fn((resolve) => resolve(returnData));

  // Chainable methods
  mock.insert = vi.fn().mockReturnValue(mock);
  mock.values = vi.fn().mockReturnValue(mock);
  mock.select = vi.fn().mockReturnValue(mock);
  mock.from = vi.fn().mockReturnValue(mock);
  mock.where = vi.fn().mockReturnValue(mock);
  mock.update = vi.fn().mockReturnValue(mock);
  mock.set = vi.fn().mockReturnValue(mock);

  return mock;
}

const TEST_AGENT_ID = '11111111-1111-1111-1111-111111111111';
const TEST_ORG_ID = '22222222-2222-2222-2222-222222222222';
const TEST_KEY_ID = '33333333-3333-3333-3333-333333333333';

// ---------------------------------------------------------------------------
// generateAgentApiKey
// ---------------------------------------------------------------------------

describe('generateAgentApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a key with qth_ prefix', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID, keyPrefix: 'qth_abcd1234' }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await generateAgentApiKey({
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
    });

    expect(result.key).toMatch(/^qth_[a-f0-9]{64}$/);
    expect(result.id).toBe(TEST_KEY_ID);
    expect(result.keyPrefix).toBe('qth_abcd1234');
  });

  it('stores a SHA-256 hash of the key (not the raw key)', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID, keyPrefix: 'qth_abcd1234' }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await generateAgentApiKey({
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
    });

    // The values() call receives the insert payload
    const insertPayload = dbMock.values.mock.calls[0][0];
    const expectedHash = createHash('sha256').update(result.key).digest('hex');
    expect(insertPayload.keyHash).toBe(expectedHash);
    // Raw key must not appear in the stored payload
    expect(insertPayload.keyHash).not.toBe(result.key);
  });

  it('sets default scopes to ["read","write"] when not provided', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID, keyPrefix: 'qth_abcd1234' }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    await generateAgentApiKey({ agentId: TEST_AGENT_ID, orgId: TEST_ORG_ID });

    const insertPayload = dbMock.values.mock.calls[0][0];
    expect(insertPayload.scopes).toEqual(['read', 'write']);
  });

  it('computes expiresAt when expiresDays is provided', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID, keyPrefix: 'qth_abcd1234' }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const before = Date.now();
    await generateAgentApiKey({
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
      expiresDays: 30,
    });

    const insertPayload = dbMock.values.mock.calls[0][0];
    const expiresAt = insertPayload.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    // Should be roughly 30 days from now
    const thirtyDaysMs = 30 * 86400000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDaysMs + 1000);
  });

  it('throws when DB insert returns nothing', async () => {
    const dbMock = createDbMock([]); // empty result
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    await expect(
      generateAgentApiKey({ agentId: TEST_AGENT_ID, orgId: TEST_ORG_ID }),
    ).rejects.toThrow('Failed to create agent API key');
  });
});

// ---------------------------------------------------------------------------
// verifyAgentApiKey
// ---------------------------------------------------------------------------

describe('verifyAgentApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns payload for a valid key', async () => {
    const rawKey = 'qth_' + 'a'.repeat(64);
    const row = {
      id: TEST_KEY_ID,
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
      scopes: ['read', 'write'],
      projectIds: null,
      rateLimitRpm: 60,
      revokedAt: null,
      expiresAt: null,
    };

    const dbMock = createDbMock([row]);
    // Also mock the fire-and-forget update chain
    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((resolve) => resolve()),
        }),
      }),
    };
    dbMock.update.mockReturnValue(updateChain);

    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await verifyAgentApiKey(rawKey);

    expect(result).toEqual({
      agent_id: TEST_AGENT_ID,
      org_id: TEST_ORG_ID,
      scopes: ['read', 'write'],
      project_ids: null,
      rate_limit_rpm: 60,
    });
  });

  it('returns null for a key without qth_ prefix', async () => {
    const result = await verifyAgentApiKey('invalid_key');
    expect(result).toBeNull();
  });

  it('returns null when key is not found in DB (revoked keys excluded by query)', async () => {
    const dbMock = createDbMock([]); // no match
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await verifyAgentApiKey('qth_' + 'b'.repeat(64));
    expect(result).toBeNull();
  });

  it('returns null for an expired key', async () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    const row = {
      id: TEST_KEY_ID,
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
      scopes: ['read'],
      projectIds: null,
      rateLimitRpm: 60,
      revokedAt: null,
      expiresAt: pastDate,
    };

    const dbMock = createDbMock([row]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await verifyAgentApiKey('qth_' + 'c'.repeat(64));
    expect(result).toBeNull();
  });

  it('hashes the input key with SHA-256 for DB lookup', async () => {
    const rawKey = 'qth_' + 'd'.repeat(64);
    const expectedHash = createHash('sha256').update(rawKey).digest('hex');

    const dbMock = createDbMock([]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    await verifyAgentApiKey(rawKey);

    // The where() clause should have been called with eq(keyHash, expectedHash)
    const { eq } = await import('drizzle-orm');
    expect(eq).toHaveBeenCalledWith('key_hash', expectedHash);
  });
});

// ---------------------------------------------------------------------------
// revokeApiKey
// ---------------------------------------------------------------------------

describe('revokeApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when a key is successfully revoked', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    // Chain: update -> set -> where -> returning
    dbMock.update.mockReturnValue(dbMock);
    dbMock.set.mockReturnValue(dbMock);
    dbMock.where.mockReturnValue(dbMock);
    dbMock.returning.mockResolvedValue([{ id: TEST_KEY_ID }]);

    const result = await revokeApiKey(TEST_KEY_ID, TEST_ORG_ID);
    expect(result).toBe(true);
  });

  it('returns false when key is not found or already revoked', async () => {
    const dbMock = createDbMock([]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    dbMock.update.mockReturnValue(dbMock);
    dbMock.set.mockReturnValue(dbMock);
    dbMock.where.mockReturnValue(dbMock);
    dbMock.returning.mockResolvedValue([]);

    const result = await revokeApiKey(TEST_KEY_ID, TEST_ORG_ID);
    expect(result).toBe(false);
  });

  it('sets revoked_at timestamp', async () => {
    const dbMock = createDbMock([{ id: TEST_KEY_ID }]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    dbMock.update.mockReturnValue(dbMock);
    dbMock.set.mockReturnValue(dbMock);
    dbMock.where.mockReturnValue(dbMock);
    dbMock.returning.mockResolvedValue([{ id: TEST_KEY_ID }]);

    await revokeApiKey(TEST_KEY_ID, TEST_ORG_ID);

    const setPayload = dbMock.set.mock.calls[0][0];
    expect(setPayload.revokedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// rotateApiKey
// ---------------------------------------------------------------------------

describe('rotateApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revokes the old key and generates a new one', async () => {
    const existingRow = {
      agentId: TEST_AGENT_ID,
      orgId: TEST_ORG_ID,
      label: 'my-agent-key',
      scopes: ['read', 'write'],
      projectIds: null,
      rateLimitRpm: 120,
      createdBy: null,
    };

    // We need two separate DB mock instances: one for the select+update (rotate),
    // and one for the insert (generateAgentApiKey).
    // Since getDb is called multiple times, we create a mock that handles all chains.

    const dbMock: Record<string, ReturnType<typeof vi.fn>> = {};

    // Track call count to differentiate select (fetch existing) vs select (shouldn't happen again)
    let selectCallCount = 0;
    let updateCallCount = 0;

    dbMock.select = vi.fn().mockReturnValue(dbMock);
    dbMock.from = vi.fn().mockReturnValue(dbMock);
    dbMock.where = vi.fn().mockReturnValue(dbMock);
    dbMock.limit = vi.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve([existingRow]);
      }
      return Promise.resolve([]);
    });

    dbMock.update = vi.fn().mockReturnValue(dbMock);
    dbMock.set = vi.fn().mockImplementation(() => {
      updateCallCount++;
      // For the revoke update, return a chain with where that resolves
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    });

    dbMock.insert = vi.fn().mockReturnValue(dbMock);
    dbMock.values = vi.fn().mockReturnValue(dbMock);
    dbMock.returning = vi.fn().mockResolvedValue([{ id: 'new-key-id', keyPrefix: 'qth_newkey12' }]);

    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await rotateApiKey(TEST_KEY_ID, TEST_ORG_ID);

    expect(result).not.toBeNull();
    expect(result!.key).toMatch(/^qth_[a-f0-9]{64}$/);
    expect(result!.id).toBe('new-key-id');
    // update was called (to revoke old key)
    expect(dbMock.update).toHaveBeenCalled();
    // insert was called (to create new key)
    expect(dbMock.insert).toHaveBeenCalled();
    // Label should be appended with " (rotated)"
    const insertPayload = dbMock.values.mock.calls[0][0];
    expect(insertPayload.label).toBe('my-agent-key (rotated)');
  });

  it('returns null when the key to rotate is not found', async () => {
    const dbMock = createDbMock([]);
    vi.mocked(getDb).mockReturnValue(dbMock as any);

    const result = await rotateApiKey(TEST_KEY_ID, TEST_ORG_ID);
    expect(result).toBeNull();
  });
});
