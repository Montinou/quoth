/**
 * Clerk Webhook Handler
 *
 * Syncs Clerk user, organization, and membership events to
 * public.users, public.organizations, and public.org_members tables.
 *
 * Webhook signature is verified using svix (Clerk's signing library).
 * Configure CLERK_WEBHOOK_SECRET in env vars.
 *
 * Uses Drizzle ORM with Neon serverless driver for DB access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { eq, and } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';
import { getDb } from '@/db/connection';
import { organizations, users, orgMembers, projects } from '@/db/schema';

// Clerk webhook secret for signature verification
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

interface WebhookEvent {
  type: string;
  data: Record<string, any>;
  object: string;
}

/** L-05: Normalize slug to match schema CHECK (slug ~ '^[a-z0-9-]+$') */
function normalizeSlug(raw: string | undefined | null): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
}

// ─── Clerk Metadata Sync ─────────────────────────────────────────
// Fire-and-forget: ensures Clerk publicMetadata always has project_id + tier
// so the session token claims are populated for every request.

async function syncClerkMetadata(clerkUserId: string) {
  try {
    const db = getDb();

    // Find the user's DB record
    const [user] = await db
      .select({
        defaultProjectId: users.defaultProjectId,
        defaultOrgId: users.defaultOrgId,
      })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (!user) return;

    let projectId = user.defaultProjectId;
    let tier = 'free';

    // If no default project, find the first project via org membership
    if (!projectId && user.defaultOrgId) {
      const [firstProject] = await db
        .select({ id: projects.id, tier: projects.tier })
        .from(projects)
        .where(eq(projects.orgId, user.defaultOrgId))
        .limit(1);

      if (firstProject) {
        projectId = firstProject.id;
        tier = firstProject.tier;

        // Also persist the default in the DB for future use
        await db
          .update(users)
          .set({ defaultProjectId: projectId })
          .where(eq(users.clerkUserId, clerkUserId));
      }
    } else if (projectId) {
      // Fetch the project tier
      const [proj] = await db
        .select({ tier: projects.tier })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (proj) tier = proj.tier;
    }

    if (!projectId && !user.defaultOrgId) return; // Nothing to sync yet

    const client = await clerkClient();
    await client.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        default_project_id: projectId ?? undefined,
        default_org_id: user.defaultOrgId ?? undefined,
        tier,
      },
    });

    console.log(`[Clerk Webhook] Synced metadata for ${clerkUserId}: project=${projectId}, tier=${tier}`);
  } catch (err) {
    // Fire-and-forget: log but don't fail the webhook
    console.error(`[Clerk Webhook] Failed to sync metadata for ${clerkUserId}:`, err);
  }
}

// ─── User Handlers ───────────────────────────────────────────────

async function handleUserCreated(data: Record<string, any>) {
  const email = data.email_addresses?.[0]?.email_address;
  const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

  const db = getDb();

  // Upsert: insert on conflict update
  await db
    .insert(users)
    .values({
      clerkUserId: data.id,
      email: email ?? '',
      displayName,
      avatarUrl: data.image_url ?? null,
      metadata: {
        external_accounts: data.external_accounts?.length ?? 0,
        created_via: 'clerk_webhook',
      },
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email: email ?? '',
        displayName,
        avatarUrl: data.image_url ?? null,
        metadata: {
          external_accounts: data.external_accounts?.length ?? 0,
          created_via: 'clerk_webhook',
        },
      },
    });

  // If user has org memberships in Clerk data, resolve and set default_org_id
  if (data.organization_memberships?.length > 0) {
    const firstOrgClerkId = data.organization_memberships[0].organization?.id;
    if (firstOrgClerkId) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, firstOrgClerkId))
        .limit(1);

      if (org) {
        await db
          .update(users)
          .set({ defaultOrgId: org.id })
          .where(eq(users.clerkUserId, data.id));

        // Also set default project
        const [firstProject] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.orgId, org.id))
          .limit(1);

        if (firstProject) {
          await db
            .update(users)
            .set({ defaultProjectId: firstProject.id })
            .where(eq(users.clerkUserId, data.id));
        }
      }
    }
  }

  console.log(`[Clerk Webhook] user.created: ${data.id} (${email})`);

  // Fire-and-forget: sync project_id + tier to Clerk publicMetadata
  void syncClerkMetadata(data.id);
}

async function handleUserUpdated(data: Record<string, any>) {
  const email = data.email_addresses?.[0]?.email_address;
  const displayName = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

  const db = getDb();
  await db
    .update(users)
    .set({
      email: email ?? '',
      displayName,
      avatarUrl: data.image_url ?? null,
    })
    .where(eq(users.clerkUserId, data.id));

  console.log(`[Clerk Webhook] user.updated: ${data.id}`);

  // Fire-and-forget: sync project_id + tier to Clerk publicMetadata
  void syncClerkMetadata(data.id);
}

async function handleUserDeleted(data: Record<string, any>) {
  const db = getDb();
  await db.delete(users).where(eq(users.clerkUserId, data.id));

  console.log(`[Clerk Webhook] user.deleted: ${data.id}`);
}

// ─── Organization Handlers ───────────────────────────────────────

async function handleOrganizationCreated(data: Record<string, any>) {
  const db = getDb();
  const slug = normalizeSlug(data.slug);

  await db
    .insert(organizations)
    .values({
      clerkOrgId: data.id,
      slug,
      name: data.name,
    })
    .onConflictDoUpdate({
      target: organizations.clerkOrgId,
      set: {
        slug,
        name: data.name,
      },
    });

  console.log(`[Clerk Webhook] organization.created: ${data.id} (${slug})`);
}

async function handleOrganizationUpdated(data: Record<string, any>) {
  const db = getDb();
  const slug = normalizeSlug(data.slug);
  await db
    .update(organizations)
    .set({
      name: data.name,
      slug,
    })
    .where(eq(organizations.clerkOrgId, data.id));

  console.log(`[Clerk Webhook] organization.updated: ${data.id}`);
}

async function handleOrganizationDeleted(data: Record<string, any>) {
  const db = getDb();
  await db.delete(organizations).where(eq(organizations.clerkOrgId, data.id));

  console.log(`[Clerk Webhook] organization.deleted: ${data.id}`);
}

// ─── Membership Handlers ─────────────────────────────────────────

async function resolveOrgAndUser(
  orgClerkId: string,
  userClerkId: string,
): Promise<{ orgId: string; userId: string } | null> {
  const db = getDb();

  const [orgResult, userResult] = await Promise.all([
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkOrgId, orgClerkId))
      .limit(1),
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, userClerkId))
      .limit(1),
  ]);

  if (!orgResult[0] || !userResult[0]) {
    console.warn(
      `[Clerk Webhook] Could not resolve org (${orgClerkId}) or user (${userClerkId})`,
    );
    return null;
  }

  return { orgId: orgResult[0].id, userId: userResult[0].id };
}

async function handleMembershipCreated(data: Record<string, any>) {
  const resolved = await resolveOrgAndUser(
    data.organization?.id ?? data.organization_id,
    data.public_user_data?.user_id ?? data.user_id,
  );
  if (!resolved) return;

  const db = getDb();
  await db
    .insert(orgMembers)
    .values({
      orgId: resolved.orgId,
      userId: resolved.userId,
      role: data.role ?? 'member',
    })
    .onConflictDoUpdate({
      target: [orgMembers.orgId, orgMembers.userId],
      set: {
        role: data.role ?? 'member',
      },
    });

  // Set user's default_org_id if not already set (first org membership)
  const [currentUser] = await db
    .select({ defaultOrgId: users.defaultOrgId })
    .from(users)
    .where(eq(users.id, resolved.userId))
    .limit(1);

  if (!currentUser?.defaultOrgId) {
    await db
      .update(users)
      .set({ defaultOrgId: resolved.orgId })
      .where(eq(users.id, resolved.userId));

    // Also set default project to the first project in this org
    const [firstProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, resolved.orgId))
      .limit(1);

    if (firstProject) {
      await db
        .update(users)
        .set({ defaultProjectId: firstProject.id })
        .where(eq(users.id, resolved.userId));
    }
  }

  console.log(
    `[Clerk Webhook] membership.created: user=${resolved.userId} org=${resolved.orgId} role=${data.role}`,
  );

  // New org membership might give the user access to projects — sync metadata
  const userClerkId = data.public_user_data?.user_id ?? data.user_id;
  if (userClerkId) {
    void syncClerkMetadata(userClerkId);
  }
}

async function handleMembershipDeleted(data: Record<string, any>) {
  const resolved = await resolveOrgAndUser(
    data.organization?.id ?? data.organization_id,
    data.public_user_data?.user_id ?? data.user_id,
  );
  if (!resolved) return;

  const db = getDb();
  await db
    .delete(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, resolved.orgId),
        eq(orgMembers.userId, resolved.userId),
      ),
    );

  console.log(
    `[Clerk Webhook] membership.deleted: user=${resolved.userId} org=${resolved.orgId}`,
  );
}

// ─── Event Router ────────────────────────────────────────────────

const EVENT_HANDLERS: Record<string, (data: Record<string, any>) => Promise<void>> = {
  'user.created': handleUserCreated,
  'user.updated': handleUserUpdated,
  'user.deleted': handleUserDeleted,
  'organization.created': handleOrganizationCreated,
  'organization.updated': handleOrganizationUpdated,
  'organization.deleted': handleOrganizationDeleted,
  'organizationMembership.created': handleMembershipCreated,
  'organizationMembership.deleted': handleMembershipDeleted,
};

// ─── Route Handler ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Read raw body for signature verification
  const body = await req.text();

  // Extract svix headers
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  // Verify webhook signature
  let event: WebhookEvent;
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('[Clerk Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Route to handler
  const handler = EVENT_HANDLERS[event.type];
  if (!handler) {
    console.log(`[Clerk Webhook] Unhandled event type: ${event.type}`);
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    await handler(event.data);
    return NextResponse.json({ received: true, handled: true });
  } catch (err) {
    console.error(`[Clerk Webhook] Handler error for ${event.type}:`, err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
