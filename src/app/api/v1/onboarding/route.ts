/**
 * GET  /api/v1/onboarding — current onboarding state
 * POST /api/v1/onboarding — advance onboarding step
 *
 * Persists progress in users.metadata JSONB so users can
 * close their browser and resume where they left off.
 */

import { auth } from '@clerk/nextjs/server';
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

export const runtime = 'nodejs';

// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingMeta {
  onboarding_step: number;
  onboarding_completed: boolean;
  onboarding_data: {
    orgId?: string;
    projectId?: string;
    agentId?: string;
    genesisDepth?: string;
  };
}

function parseMetadata(raw: unknown): OnboardingMeta {
  const meta = (raw ?? {}) as Record<string, unknown>;
  return {
    onboarding_step: typeof meta.onboarding_step === 'number' ? meta.onboarding_step : 0,
    onboarding_completed: meta.onboarding_completed === true,
    onboarding_data: (meta.onboarding_data as OnboardingMeta['onboarding_data']) ?? {},
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

  const body = await req.json();
  const { step, data } = body as { step: number; data: Record<string, unknown> };

  if (typeof step !== 'number' || step < 0 || step > 4) {
    return Response.json({ error: 'Invalid step' }, { status: 400 });
  }

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

      meta.onboarding_step = 2;
      meta.onboarding_data.projectId = projectId;

      await db
        .update(users)
        .set({
          defaultProjectId: projectId,
          metadata: { ...meta },
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return Response.json({ success: true, step: 2, data: meta.onboarding_data });
    }

    // ── Step 2: Agent ──────────────────────────────────────────────────
    if (step === 2) {
      const orgId = meta.onboarding_data.orgId;
      const projectId = meta.onboarding_data.projectId;

      if (!orgId || !projectId) {
        return Response.json({ error: 'Complete steps 0-1 first' }, { status: 400 });
      }

      const skipped = data.skip === true;
      let agentId: string | undefined;

      if (!skipped) {
        const agentName = slugify(String(data.agentName || 'claude'));
        const displayName = String(data.displayName || 'Claude').trim();
        const model = String(data.model || 'claude-sonnet-4-6');
        const role = String(data.role || 'orchestrator');

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
        agentId = created!.id;

        // Assign agent to project
        await db.insert(agentProjects).values({
          agentId,
          projectId,
          role: 'contributor',
          assignedBy: user.id,
        });
      }

      meta.onboarding_step = 3;
      if (agentId) meta.onboarding_data.agentId = agentId;

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
