import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();

/**
 * Create a mock drizzle query builder chain.
 * Every method returns the chain for chaining; `returning()` returns a promise.
 * Awaiting the chain resolves to the configured terminal value.
 */
function createDbChain() {
  let terminalValue: unknown = [];

  const chain: Record<string, unknown> = {};

  const methodNames = [
    'from', 'where', 'orderBy', 'limit', 'offset', 'set', 'values',
    'onConflictDoNothing', 'onConflictDoUpdate',
  ];

  for (const name of methodNames) {
    chain[name] = vi.fn().mockImplementation(() => chain);
  }

  chain['returning'] = vi.fn().mockImplementation(() => Promise.resolve(terminalValue));

  chain['then'] = function (
    resolve?: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    return Promise.resolve(terminalValue).then(resolve, reject);
  };

  chain['_resolve'] = (val: unknown) => { terminalValue = val; };

  return chain as Record<string, unknown> & { _resolve: (val: unknown) => void };
}

const insertProxy = createDbChain();
const selectProxy = createDbChain();
const updateProxy = createDbChain();

vi.mock('@/db/connection', () => ({
  getDb: () => ({
    insert: vi.fn().mockReturnValue(insertProxy),
    select: vi.fn().mockReturnValue(selectProxy),
    update: vi.fn().mockReturnValue(updateProxy),
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
  createTask,
  claimTask,
  completeTask,
  reassignTask,
  autoFailOverdueTasks,
} from '@/lib/comms/tasks';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTask = {
  id: 'task-1',
  orgId: 'org-1',
  title: 'Test task',
  description: null,
  assignedTo: 'agent-b',
  createdBy: 'agent-a',
  projectId: null,
  status: 'pending',
  priority: 5,
  payload: null,
  result: null,
  startedAt: null,
  completedAt: null,
  deadline: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertProxy._resolve([baseTask]);
  });

  it('creates a task with correct fields', async () => {
    const result = await createTask({
      title: 'Test task',
      assignedTo: 'agent-b',
      createdBy: 'agent-a',
      orgId: 'org-1',
    });

    expect(result).toMatchObject({
      id: 'task-1',
      title: 'Test task',
      assignedTo: 'agent-b',
      createdBy: 'agent-a',
      status: 'pending',
      priority: 5,
    });
  });

  it('verifies project access for both creator and assignee', async () => {
    await createTask({
      title: 'Project task',
      assignedTo: 'agent-b',
      createdBy: 'agent-a',
      orgId: 'org-1',
      projectId: 'proj-1',
    });

    expect(mockVerifyProjectAccess).toHaveBeenCalledTimes(2);
    expect(mockVerifyProjectAccess).toHaveBeenCalledWith('agent-a', 'proj-1');
    expect(mockVerifyProjectAccess).toHaveBeenCalledWith('agent-b', 'proj-1');
  });

  it('throws when priority out of range', async () => {
    await expect(
      createTask({
        title: 'Bad priority',
        assignedTo: 'agent-b',
        createdBy: 'agent-a',
        orgId: 'org-1',
        priority: 11,
      }),
    ).rejects.toThrow('Priority must be between 1 and 10');
  });

  it('defaults priority to 5', async () => {
    const result = await createTask({
      title: 'Default priority',
      assignedTo: 'agent-b',
      createdBy: 'agent-a',
      orgId: 'org-1',
    });

    expect(result).toMatchObject({ priority: 5 });
  });
});

describe('claimTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions pending task to in_progress for assigned agent', async () => {
    const claimed = { ...baseTask, status: 'in_progress', startedAt: new Date() };
    updateProxy._resolve([claimed]);

    const result = await claimTask('task-1', 'agent-b');

    expect(result).toMatchObject({ status: 'in_progress' });
    expect(result!.startedAt).toBeDefined();
  });

  it('returns null when wrong agent tries to claim', async () => {
    updateProxy._resolve([]);

    const result = await claimTask('task-1', 'agent-wrong');

    expect(result).toBeNull();
  });

  it('returns null when task is not pending', async () => {
    updateProxy._resolve([]);

    const result = await claimTask('task-1', 'agent-b');

    expect(result).toBeNull();
  });
});

describe('completeTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transitions in_progress task to done', async () => {
    const completed = {
      ...baseTask,
      status: 'done',
      result: { output: 'finished' },
      completedAt: new Date(),
    };
    updateProxy._resolve([completed]);

    const result = await completeTask('task-1', 'agent-b', { output: 'finished' });

    expect(result).toMatchObject({ status: 'done' });
    expect(result!.completedAt).toBeDefined();
  });

  it('returns null when task is not in_progress', async () => {
    updateProxy._resolve([]);

    const result = await completeTask('task-1', 'agent-b', {});

    expect(result).toBeNull();
  });
});

describe('reassignTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets task to pending and assigns to new agent', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 'task-1' }] });

    const result = await reassignTask('task-1', 'agent-c', 'agent-a');

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns false when task cannot be reassigned (wrong status)', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await reassignTask('task-1', 'agent-c', 'agent-a');

    expect(result).toBe(false);
  });
});

describe('autoFailOverdueTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls SQL function and returns count of affected rows', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 'task-1' }, { id: 'task-2' }],
    });

    const count = await autoFailOverdueTasks();

    expect(count).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when no overdue tasks', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const count = await autoFailOverdueTasks();

    expect(count).toBe(0);
  });
});
