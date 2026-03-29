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
import { getDb } from '@/db/connection';
import { organizations, users, orgMembers } from '@/db/schema';

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

  console.log(`[Clerk Webhook] user.created: ${data.id} (${email})`);
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

  console.log(
    `[Clerk Webhook] membership.created: user=${resolved.userId} org=${resolved.orgId} role=${data.role}`,
  );
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
