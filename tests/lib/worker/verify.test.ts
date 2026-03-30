import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// QStash Receiver mock
// ---------------------------------------------------------------------------

const mockVerify = vi.fn();

vi.mock('@upstash/qstash', () => {
  return {
    Receiver: class {
      verify = mockVerify;
    },
  };
});

// ---------------------------------------------------------------------------
// NextRequest mock helper
// ---------------------------------------------------------------------------

function makeRequest(
  headers: Record<string, string> = {},
  body: string = '',
): any {
  const headerMap = new Map(Object.entries(headers));
  return {
    headers: {
      get: (key: string) => headerMap.get(key) ?? null,
    },
    text: vi.fn().mockResolvedValue(body),
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { verifyCronAuth } from '@/lib/worker/verify';

describe('worker/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockReset();
    process.env.CRON_SECRET = 'test-cron-secret-123';
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
  });

  // -------------------------------------------------------------------------
  // verifyCronAuth - CRON_SECRET
  // -------------------------------------------------------------------------
  describe('CRON_SECRET Bearer token', () => {
    it('accepts valid Bearer token', async () => {
      const req = makeRequest({
        authorization: 'Bearer test-cron-secret-123',
      });

      const result = await verifyCronAuth(req);
      expect(result).toBeNull(); // null = authorized
    });

    it('rejects invalid Bearer token', async () => {
      const req = makeRequest({
        authorization: 'Bearer wrong-secret',
      });
      mockVerify.mockRejectedValue(new Error('bad sig'));

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(body.error).toBe('Unauthorized');
      expect(result!.status).toBe(401);
    });

    it('rejects missing authorization header', async () => {
      const req = makeRequest({});
      mockVerify.mockRejectedValue(new Error('bad sig'));

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // verifyCronAuth - QStash signature
  // -------------------------------------------------------------------------
  describe('QStash signature', () => {
    it('accepts valid QStash signature', async () => {
      mockVerify.mockResolvedValue(true);

      const req = makeRequest(
        { 'upstash-signature': 'valid-sig-abc' },
        '{"cron": true}',
      );

      const result = await verifyCronAuth(req);
      expect(result).toBeNull(); // authorized

      expect(mockVerify).toHaveBeenCalledWith({
        signature: 'valid-sig-abc',
        body: '{"cron": true}',
      });
    });

    it('rejects invalid QStash signature', async () => {
      mockVerify.mockRejectedValue(new Error('Invalid signature'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const req = makeRequest(
        { 'upstash-signature': 'bad-sig' },
        '{"cron": true}',
      );

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      errorSpy.mockRestore();
    });

    it('falls back to QStash when CRON_SECRET does not match', async () => {
      mockVerify.mockResolvedValue(true);

      const req = makeRequest({
        authorization: 'Bearer wrong-secret',
        'upstash-signature': 'valid-sig',
      });

      const result = await verifyCronAuth(req);
      expect(result).toBeNull(); // authorized via QStash fallback
      expect(mockVerify).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // verifyCronAuth - no auth configured
  // -------------------------------------------------------------------------
  describe('no auth configured', () => {
    it('returns 500 when CRON_SECRET not set and no QStash signature', async () => {
      delete process.env.CRON_SECRET;

      const req = makeRequest({});

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(500);

      const body = await result!.json();
      expect(body.error).toContain('CRON_SECRET not configured');
    });
  });
});
