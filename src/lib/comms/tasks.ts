/**
 * Task queue for the Quoth communication bus.
 *
 * Tasks are structured work items assigned to agents, stored in comms.tasks.
 * The NOTIFY trigger (comms.notify_task_assigned) fires on insert,
 * sending to channel: agent_tasks_{assignedToIdNoHyphens}
 *
 * Lifecycle:
 *   pending -> in_progress -> done      (success)
 *   pending -> in_progress -> failed    (error)
 *   pending -> cancelled                (cancelled before claim)
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "@/db/connection";
import { tasks } from "@/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "cancelled";

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedTo: string;
  createdBy: string;
  orgId: string;
  projectId?: string;
  priority?: number; // 1-10, default 5
  deadline?: Date;
  payload?: Record<string, unknown>;
}

export interface ListTasksFilters {
  status?: TaskStatus;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskRow {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  assignedTo: string;
  createdBy: string;
  projectId: string | null;
  status: string | null;
  priority: number | null;
  payload: unknown;
  result: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  deadline: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a new task and assign it to an agent.
 * The NOTIFY trigger fires automatically on insert.
 */
export async function createTask(input: CreateTaskInput): Promise<TaskRow> {
  const db = getDb();

  const priority = input.priority ?? 5;
  if (priority < 1 || priority > 10) {
    throw new Error("Priority must be between 1 and 10");
  }

  const [row] = await db
    .insert(tasks)
    .values({
      orgId: input.orgId,
      title: input.title,
      description: input.description ?? null,
      assignedTo: input.assignedTo,
      createdBy: input.createdBy,
      projectId: input.projectId ?? null,
      priority,
      deadline: input.deadline ?? null,
      payload: input.payload ?? null,
      status: "pending",
    })
    .returning();

  return row as TaskRow;
}

// ---------------------------------------------------------------------------
// Claim / Transition
// ---------------------------------------------------------------------------

/**
 * Claim a pending task (transitions to in_progress).
 * Only the assigned agent can claim their own tasks.
 */
export async function claimTask(
  taskId: string,
  agentId: string,
): Promise<TaskRow | null> {
  const db = getDb();

  const [row] = await db
    .update(tasks)
    .set({
      status: "in_progress",
      startedAt: sql`now()`,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.assignedTo, agentId),
        eq(tasks.status, "pending"),
      ),
    )
    .returning();

  return (row as TaskRow) ?? null;
}

/**
 * Complete a task with a result payload.
 * Only the assigned agent can complete their in-progress tasks.
 */
export async function completeTask(
  taskId: string,
  agentId: string,
  result: unknown,
): Promise<TaskRow | null> {
  const db = getDb();

  const [row] = await db
    .update(tasks)
    .set({
      status: "done",
      result: result ?? {},
      completedAt: sql`now()`,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.assignedTo, agentId),
        eq(tasks.status, "in_progress"),
      ),
    )
    .returning();

  return (row as TaskRow) ?? null;
}

/**
 * Fail a task with an error description.
 * Only the assigned agent can fail their in-progress tasks.
 */
export async function failTask(
  taskId: string,
  agentId: string,
  error: string,
): Promise<TaskRow | null> {
  const db = getDb();

  const [row] = await db
    .update(tasks)
    .set({
      status: "failed",
      result: { error },
      completedAt: sql`now()`,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.assignedTo, agentId),
        eq(tasks.status, "in_progress"),
      ),
    )
    .returning();

  return (row as TaskRow) ?? null;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * List tasks for an agent, with optional status/project filters.
 */
export async function listTasks(
  agentId: string,
  filters: ListTasksFilters = {},
): Promise<TaskRow[]> {
  const db = getDb();
  const { limit = 50, offset = 0 } = filters;

  const conditions = [eq(tasks.assignedTo, agentId)];

  if (filters.status) {
    conditions.push(eq(tasks.status, filters.status));
  }
  if (filters.projectId) {
    conditions.push(eq(tasks.projectId, filters.projectId));
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset);

  return rows as TaskRow[];
}

/**
 * Get a single task by ID.
 */
export async function getTask(
  taskId: string,
  orgId: string,
): Promise<TaskRow | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .limit(1);

  return (row as TaskRow) ?? null;
}
