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

describe('worker/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerify.mockReset();
  });

  // -------------------------------------------------------------------------
  // This test MUST run before others to test the case where signing keys
  // are missing, since getReceiver() caches the Receiver instance.
  // -------------------------------------------------------------------------
  describe('no signing keys configured', () => {
    it('returns 500 when QStash signing keys not set', async () => {
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
      delete process.env.QSTASH_NEXT_SIGNING_KEY;

      // Re-import to reset the cached receiver singleton
      vi.resetModules();
      const { verifyCronAuth } = await import('@/lib/worker/verify');

      const req = makeRequest({ 'upstash-signature': 'some-sig' });

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(500);

      const body = await result!.json();
      expect(body.error).toContain('signing keys not configured');
    });
  });

  // -------------------------------------------------------------------------
  // QStash signature validation
  // -------------------------------------------------------------------------
  describe('QStash signature', () => {
    beforeEach(() => {
      process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
      process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
    });

    it('accepts valid QStash signature', async () => {
      vi.resetModules();
      const { verifyCronAuth } = await import('@/lib/worker/verify');

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
      vi.resetModules();
      const { verifyCronAuth } = await import('@/lib/worker/verify');

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

    it('rejects missing upstash-signature header with 401', async () => {
      vi.resetModules();
      const { verifyCronAuth } = await import('@/lib/worker/verify');

      const req = makeRequest({});

      const result = await verifyCronAuth(req);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);

      const body = await result!.json();
      expect(body.error).toContain('Missing Upstash-Signature');
    });
  });
});
