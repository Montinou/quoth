/**
 * GET  /api/v1/onboarding — current onboarding state
 * POST /api/v1/onboarding — advance onboarding step
 *
 * Persists progress in users.metadata JSONB so users can
 * close their browser and resume where they left off.
 */

import { z } from 'zod';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { getDb } from '@/db/connection';
import {
  users,
  organizations,
  orgMembers,
  projects,
  projectMembers,
  agentRegistry,
  agentProjects,
} from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

/**
 * Sync user metadata to Clerk so JWT template can include project_id/tier.
 * Fire-and-forget — never blocks onboarding flow.
 */
async function syncToClerk(clerkUserId: string, meta: Record<string, unknown>) {
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(clerkUserId, {
      publicMetadata: meta,
    });
  } catch (err) {
    console.error('[onboarding] Failed to sync metadata to Clerk:', err);
  }
}


// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingMeta {
  onboarding_step: number;
  onboarding_completed: boolean;
  onboarding_data: {
    orgId?: string;
    projectIds: string[];
    agentIds: string[];
    genesisDepth?: string;
    // Backward compat — old single-value fields
    projectId?: string;
    agentId?: string;
  };
}

function parseMetadata(raw: unknown): OnboardingMeta {
  const meta = (raw ?? {}) as Record<string, unknown>;
  const data = (meta.onboarding_data as Record<string, unknown>) ?? {};

  // Backward compat: migrate old single projectId/agentId to arrays
  let projectIds: string[] = Array.isArray(data.projectIds) ? (data.projectIds as string[]) : [];
  if (!projectIds.length && typeof data.projectId === 'string' && data.projectId) {
    projectIds = [data.projectId];
  }

  let agentIds: string[] = Array.isArray(data.agentIds) ? (data.agentIds as string[]) : [];
  if (!agentIds.length && typeof data.agentId === 'string' && data.agentId) {
    agentIds = [data.agentId];
  }

  return {
    onboarding_step: typeof meta.onboarding_step === 'number' ? meta.onboarding_step : 0,
    onboarding_completed: meta.onboarding_completed === true,
    onboarding_data: {
      orgId: typeof data.orgId === 'string' ? data.orgId : undefined,
      projectIds,
      agentIds,
      genesisDepth: typeof data.genesisDepth === 'string' ? data.genesisDepth : undefined,
    },
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const [user] = await db
    .select({ metadata: users.metadata })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const meta = parseMetadata(user.metadata);

  return Response.json({
    step: meta.onboarding_step,
    completed: meta.onboarding_completed,
    data: meta.onboarding_data,
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const OnboardingInput = z.object({
    step: z.number().int().min(0).max(4),
    data: z.record(z.unknown()),
  });

  const parsed = OnboardingInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const { step, data } = parsed.data;

  const db = getDb();

  // Fetch user row
  const [user] = await db
    .select({ id: users.id, metadata: users.metadata })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const meta = parseMetadata(user.metadata);

  try {
    // ── Step 0: Organization ───────────────────────────────────────────
    if (step === 0) {
      const orgName = String(data.orgName || '').trim();
      const orgSlug = slugify(String(data.orgSlug || orgName));

      if (!orgName || !orgSlug) {
        return Response.json({ error: 'Organization name is required' }, { status: 400 });
      }

      // Find or create org
      let [existing] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, orgSlug))
        .limit(1);

      let orgId: string;

      if (existing) {
        orgId = existing.id;
      } else {
        const [created] = await db
          .insert(organizations)
          .values({ name: orgName, slug: orgSlug })
          .returning({ id: organizations.id });
        orgId = created!.id;

        // Add user as owner of the org
        await db.insert(orgMembers).values({
          orgId,
          userId: user.id,
          role: 'owner',
        });
      }

      // Update user default org
      meta.onboarding_step = 1;
      meta.onboarding_data.orgId = orgId;

      await db
        .update(users)
        .set({
          defaultOrgId: orgId,
          metadata: { ...meta },
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 1, data: meta.onboarding_data });
    }

    // ── Step 1: Project ────────────────────────────────────────────────
    if (step === 1) {
      const orgId = meta.onboarding_data.orgId;
      if (!orgId) {
        return Response.json({ error: 'Complete step 0 first' }, { status: 400 });
      }

      const action = String(data.action || 'continue');

      if (action === 'add') {
        const projectName = String(data.projectName || '').trim();
        const projectSlug = slugify(String(data.projectSlug || projectName));
        const description = data.description ? String(data.description).trim() : null;

        if (!projectName || !projectSlug) {
          return Response.json({ error: 'Project name is required' }, { status: 400 });
        }

        // Check for duplicate slug within org
        const [dupCheck] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.orgId, orgId), eq(projects.slug, projectSlug)))
          .limit(1);

        let projectId: string;

        if (dupCheck) {
          projectId = dupCheck.id;
        } else {
          const [created] = await db
            .insert(projects)
            .values({ orgId, name: projectName, slug: projectSlug, description })
            .returning({ id: projects.id });
          projectId = created!.id;

          // Add user as admin of the project
          await db.insert(projectMembers).values({
            projectId,
            userId: user.id,
            role: 'admin',
          });
        }

        // Set defaultProjectId on first project
        const isFirst = meta.onboarding_data.projectIds.length === 0;
        meta.onboarding_data.projectIds = [...meta.onboarding_data.projectIds, projectId];

        const updateSet: Record<string, unknown> = {
          metadata: { ...meta },
          updatedAt: new Date(),
        };
        if (isFirst) {
          updateSet.defaultProjectId = projectId;
        }

        await db.update(users).set(updateSet).where(eq(users.id, user.id));

        // Sync default_project_id to Clerk so JWT template includes it
        if (isFirst) {
          void syncToClerk(userId, { default_project_id: projectId });
        }

        return Response.json({ success: true, step: 1, data: meta.onboarding_data });
      }

      // action === 'continue' — advance to step 2
      if (!meta.onboarding_data.projectIds.length) {
        return Response.json({ error: 'Create at least one project' }, { status: 400 });
      }

      meta.onboarding_step = 2;

      await db
        .update(users)
        .set({ metadata: { ...meta }, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 2, data: meta.onboarding_data });
    }

    // ── Step 2: Agent ──────────────────────────────────────────────────
    if (step === 2) {
      const orgId = meta.onboarding_data.orgId;

      if (!orgId || !meta.onboarding_data.projectIds.length) {
        return Response.json({ error: 'Complete steps 0-1 first' }, { status: 400 });
      }

      const action = String(data.action || 'continue');

      if (action === 'add') {
        const agentName = slugify(String(data.agentName || 'claude'));
        const displayName = String(data.displayName || 'Claude').trim();
        const model = String(data.model || 'claude-sonnet-4-6');
        const role = String(data.role || 'orchestrator');
        // Which project to assign the agent to (defaults to first)
        const targetProjectId = String(
          data.projectId || meta.onboarding_data.projectIds[0]
        );

        // Generate a signing key for the agent
        const signingKey = randomBytes(32).toString('hex');

        const [created] = await db
          .insert(agentRegistry)
          .values({
            orgId,
            agentName,
            displayName,
            instance: 'onboarding',
            model,
            role,
            signingKey,
            status: 'active',
            capabilities: {},
          })
          .returning({ id: agentRegistry.id });
        const agentId = created!.id;

        // Assign agent to selected project
        await db.insert(agentProjects).values({
          agentId,
          projectId: targetProjectId,
          role: 'contributor',
          assignedBy: user.id,
        });

        meta.onboarding_data.agentIds = [...meta.onboarding_data.agentIds, agentId];

        await db
          .update(users)
          .set({ metadata: { ...meta }, updatedAt: new Date() })
          .where(eq(users.id, user.id));

        return Response.json({ success: true, step: 2, data: meta.onboarding_data });
      }

      // action === 'continue' or 'skip' — advance to step 3
      meta.onboarding_step = 3;

      await db
        .update(users)
        .set({ metadata: { ...meta }, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 3, data: meta.onboarding_data });
    }

    // ── Step 3: Genesis ────────────────────────────────────────────────
    if (step === 3) {
      const genesisDepth = String(data.genesisDepth || 'skip');

      meta.onboarding_step = 4;
      meta.onboarding_data.genesisDepth = genesisDepth;

      await db
        .update(users)
        .set({ metadata: { ...meta }, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 4, data: meta.onboarding_data });
    }

    // ── Step 4: Done ───────────────────────────────────────────────────
    if (step === 4) {
      meta.onboarding_step = 4;
      meta.onboarding_completed = true;

      await db
        .update(users)
        .set({ metadata: { ...meta }, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 4, data: meta.onboarding_data });
    }

    return Response.json({ error: 'Invalid step' }, { status: 400 });
  } catch (err) {
    console.error('[onboarding] step', step, err);
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    return Response.json({ error: message }, { status: 500 });
  }
}
