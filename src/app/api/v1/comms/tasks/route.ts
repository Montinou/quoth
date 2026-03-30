/**
 * POST  /api/v1/comms/tasks -- Create a task
 * GET   /api/v1/comms/tasks -- List tasks for the authenticated agent
 * PATCH /api/v1/comms/tasks -- Update task status (claim, complete, fail)
 * PUT   /api/v1/comms/tasks -- Reassign a task to a different agent
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import {
  createTask,
  claimTask,
  completeTask,
  failTask,
  listTasks,
  reassignTask,
  getTask,
} from '@/lib/comms/tasks';
import { forbidden, notFound, badRequest } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createTaskBody = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  assignedTo: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  priority: z.number().int().min(1).max(10).optional().default(5),
  deadline: z.string().datetime().optional(),
  payload: z.record(z.unknown()).optional(),
});

const listTasksQuery = z.object({
  status: z.enum(['pending', 'in_progress', 'done', 'failed', 'cancelled']).optional(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const updateTaskBody = z.object({
  taskId: z.string().uuid(),
  action: z.enum(['claim', 'complete', 'fail']),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(2000).optional(),
});

const reassignTaskBody = z.object({
  taskId: z.string().uuid(),
  newAgentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST -- Create task
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: createTaskBody },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can create tasks.');
    }

    const body = req.validatedBody as z.infer<typeof createTaskBody>;

    const task = await createTask({
      title: body.title,
      description: body.description,
      assignedTo: body.assignedTo,
      createdBy: ctx!.agentId,
      orgId: ctx!.orgId,
      projectId: body.projectId ?? ctx!.projectId ?? undefined,
      priority: body.priority,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      payload: body.payload,
    });

    return Response.json({ data: task }, { status: 201 });
  },
);

// ---------------------------------------------------------------------------
// GET -- List tasks
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listTasksQuery },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can list their tasks.');
    }

    const { status, projectId, limit, offset } = req.validatedQuery as z.infer<
      typeof listTasksQuery
    >;

    const taskList = await listTasks(ctx!.agentId, {
      status: status as any,
      projectId,
      limit,
      offset,
    });

    return Response.json({ data: taskList, count: taskList.length });
  },
);

// ---------------------------------------------------------------------------
// PATCH -- Update task status
// ---------------------------------------------------------------------------

export const PATCH = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: updateTaskBody },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can update tasks.');
    }

    const body = req.validatedBody as z.infer<typeof updateTaskBody>;

    let task;
    switch (body.action) {
      case 'claim':
        task = await claimTask(body.taskId, ctx!.agentId);
        break;
      case 'complete':
        task = await completeTask(body.taskId, ctx!.agentId, body.result ?? {});
        break;
      case 'fail':
        task = await failTask(body.taskId, ctx!.agentId, body.error ?? 'Unknown error');
        break;
    }

    if (!task) {
      throw notFound(
        'Task not found, not assigned to you, or not in the correct state for this action.',
      );
    }

    return Response.json({ data: task });
  },
);

// ---------------------------------------------------------------------------
// PUT -- Reassign task to a different agent
// ---------------------------------------------------------------------------

export const PUT = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: reassignTaskBody },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can reassign tasks.');
    }

    const body = req.validatedBody as z.infer<typeof reassignTaskBody>;

    // Auth: admin role or the agent who created the task
    const task = await getTask(body.taskId, ctx!.orgId);
    if (!task) {
      throw notFound('Task not found.');
    }

    const isAdmin = ctx!.role === 'admin' || ctx!.role === 'owner';
    const isCreator = task.createdBy === ctx!.agentId;

    if (!isAdmin && !isCreator) {
      throw forbidden('Only admins or the task creator can reassign tasks.');
    }

    const success = await reassignTask(body.taskId, body.newAgentId, ctx!.agentId);
    if (!success) {
      throw badRequest(
        'Task could not be reassigned. It may already be done, failed, or cancelled.',
      );
    }

    return Response.json({
      data: { reassigned: true, taskId: body.taskId, newAgentId: body.newAgentId },
    });
  },
);
