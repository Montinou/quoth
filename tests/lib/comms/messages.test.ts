import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();

/**
 * Create a mock that behaves like a drizzle query builder:
 * - Every method call returns the same chain (for method chaining)
 * - `returning()` returns a Promise resolving to terminalValue
 * - Awaiting the chain itself also resolves to terminalValue
 *   (drizzle query builders are thenable)
 */
function createDbChain() {
  let terminalValue: unknown = [];

  // We store the chain methods here so they persist across calls
  const chain: Record<string, unknown> = {};

  const methodNames = [
    'from', 'where', 'orderBy', 'limit', 'offset', 'set', 'values',
    'onConflictDoNothing', 'onConflictDoUpdate',
  ];

  for (const name of methodNames) {
    chain[name] = vi.fn().mockImplementation(() => chain);
  }

  // `returning()` is a terminal that returns a promise
  chain['returning'] = vi.fn().mockImplementation(() => Promise.resolve(terminalValue));

  // Make the chain thenable so `await db.select().from()...` works.
  // This `.then` must NOT itself return the chain (to avoid infinite recursion).
  chain['then'] = function (
    resolve?: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    return Promise.resolve(terminalValue).then(resolve, reject);
  };

  // Test helper to configure the return value
  chain['_resolve'] = (val: unknown) => { terminalValue = val; };

  return chain as Record<string, unknown> & { _resolve: (val: unknown) => void };
}

const insertProxy = createDbChain();
const selectProxy = createDbChain();
const updateProxy = createDbChain();
const deleteProxy = createDbChain();

vi.mock('@/db/connection', () => ({
  getDb: () => ({
    insert: vi.fn().mockReturnValue(insertProxy),
    select: vi.fn().mockReturnValue(selectProxy),
    update: vi.fn().mockReturnValue(updateProxy),
    delete: vi.fn().mockReturnValue(deleteProxy),
    execute: (...args: unknown[]) => mockExecute(...args),
  }),
}));

const mockVerifyProjectAccess = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/comms/utils', () => ({
  verifyProjectAccess: (...args: unknown[]) => mockVerifyProjectAccess(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  sendMessage,
  getInbox,
  markAsRead,
  replyToMessage,
  getThread,
} from '@/lib/comms/messages';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseMessage = {
  id: 'msg-1',
  orgId: 'org-1',
  fromAgentId: 'agent-a',
  toAgentId: 'agent-b',
  channelId: null,
  replyTo: null,
  messageType: 'message',
  priority: 'normal',
  payload: { text: 'hello' },
  signature: null,
  status: 'pending',
  deliveredAt: null,
  readAt: null,
  errorMessage: null,
  retryCount: null,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertProxy._resolve([baseMessage]);
    selectProxy._resolve([]);
  });

  it('inserts a direct message with correct fields', async () => {
    const result = await sendMessage('agent-a', 'org-1', {
      toAgentId: 'agent-b',
      content: { text: 'hello' },
      messageType: 'message',
      priority: 'normal',
    });

    expect(result).toMatchObject({ id: 'msg-1', fromAgentId: 'agent-a', toAgentId: 'agent-b' });
  });

  it('inserts a channel message and verifies project access', async () => {
    selectProxy._resolve([{ projectId: 'proj-1' }]);
    insertProxy._resolve([{
      ...baseMessage,
      toAgentId: null,
      channelId: 'ch-1',
    }]);

    const result = await sendMessage('agent-a', 'org-1', {
      channelId: 'ch-1',
      content: { text: 'broadcast' },
    });

    expect(result.channelId).toBe('ch-1');
    expect(result.toAgentId).toBeNull();
    expect(mockVerifyProjectAccess).toHaveBeenCalledWith('agent-a', 'proj-1');
  });

  it('throws when neither toAgentId nor channelId provided', async () => {
    await expect(
      sendMessage('agent-a', 'org-1', { content: 'nope' }),
    ).rejects.toThrow('Either toAgentId or channelId must be provided');
  });

  it('throws when both toAgentId and channelId provided', async () => {
    await expect(
      sendMessage('agent-a', 'org-1', {
        toAgentId: 'agent-b',
        channelId: 'ch-1',
        content: 'nope',
      }),
    ).rejects.toThrow('Cannot specify both toAgentId and channelId');
  });
});

describe('getInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectProxy._resolve([baseMessage]);
  });

  it('returns messages for the agent', async () => {
    const results = await getInbox('agent-b');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toAgentId: 'agent-b' });
  });

  it('respects status filter', async () => {
    selectProxy._resolve([{ ...baseMessage, status: 'read' }]);

    const results = await getInbox('agent-b', { status: 'read' });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('read');
  });

  it('supports array status filter', async () => {
    selectProxy._resolve([baseMessage]);

    const results = await getInbox('agent-b', { status: ['pending', 'delivered'] });

    expect(results).toHaveLength(1);
  });
});

describe('markAsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates message status to read', async () => {
    const readMsg = { ...baseMessage, status: 'read', readAt: new Date() };
    updateProxy._resolve([readMsg]);

    const result = await markAsRead('msg-1', 'agent-b');

    expect(result).toMatchObject({ status: 'read' });
    expect(result!.readAt).toBeDefined();
  });

  it('returns null when message not found or wrong agent', async () => {
    updateProxy._resolve([]);

    const result = await markAsRead('msg-999', 'agent-wrong');

    expect(result).toBeNull();
  });
});

describe('replyToMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectProxy._resolve([baseMessage]);
  });

  it('sets replyTo field and routes reply to original sender', async () => {
    const replyMsg = {
      ...baseMessage,
      id: 'msg-reply',
      fromAgentId: 'agent-b',
      toAgentId: 'agent-a',
      replyTo: 'msg-1',
    };
    insertProxy._resolve([replyMsg]);

    const result = await replyToMessage('msg-1', 'agent-b', 'org-1', { text: 'reply' });

    expect(result.replyTo).toBe('msg-1');
    expect(result.toAgentId).toBe('agent-a');
  });

  it('routes channel reply to same channel', async () => {
    const channelMsg = { ...baseMessage, toAgentId: null, channelId: 'ch-1' };
    selectProxy._resolve([channelMsg]);

    const replyMsg = { ...channelMsg, id: 'msg-reply', replyTo: 'msg-1', fromAgentId: 'agent-b' };
    insertProxy._resolve([replyMsg]);

    const result = await replyToMessage('msg-1', 'agent-b', 'org-1', { text: 'channel reply' });

    expect(result.channelId).toBe('ch-1');
  });

  it('throws when original message not found', async () => {
    selectProxy._resolve([]);

    await expect(
      replyToMessage('msg-gone', 'agent-b', 'org-1', 'reply'),
    ).rejects.toThrow('Original message not found');
  });
});

describe('getThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full thread via recursive CTE', async () => {
    const threadRows = [
      { ...baseMessage, id: 'msg-root', replyTo: null },
      { ...baseMessage, id: 'msg-reply-1', replyTo: 'msg-root' },
      { ...baseMessage, id: 'msg-reply-2', replyTo: 'msg-reply-1' },
    ];
    mockExecute.mockResolvedValueOnce({ rows: threadRows });

    const result = await getThread('msg-reply-2');

    expect(result).toHaveLength(3);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe('verifyProjectAccess (via sendMessage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectProxy._resolve([{ projectId: 'proj-x' }]);
  });

  it('blocks cross-project message when agent has no membership', async () => {
    mockVerifyProjectAccess.mockRejectedValueOnce(
      new Error('Agent does not have access to this project'),
    );

    await expect(
      sendMessage('agent-a', 'org-1', { channelId: 'ch-restricted', content: 'hi' }),
    ).rejects.toThrow('Agent does not have access to this project');
  });
});
