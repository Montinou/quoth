/**
 * /api/proposals/[id]/approve
 *   POST — Approve a pending proposal.
 */

export const runtime = 'nodejs';

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';
import { getSecureDb } from '@/db/connection';
import { proposals, users } from '@/db/schema';
import { notFound, forbidden, badRequest } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const approveBody = z.object({
  reviewerEmail: z.string().email(),
});

// ---------------------------------------------------------------------------
// POST /api/proposals/:id/approve
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: approveBody },
  },
  async (_req, ctx, params) => {
    const body = _req.validatedBody as z.infer<typeof approveBody>;
    const db = await getSecureDb(ctx!.orgId, ctx!.userId);

    // Verify proposal exists and belongs to the caller's project
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.id, params.id),
          eq(proposals.projectId, ctx!.projectId),
        ),
      )
      .limit(1);

    if (!proposal) {
      throw notFound(`Proposal ${params.id} not found.`);
    }

    if (proposal.status !== 'pending') {
      throw badRequest(
        `Proposal is already ${proposal.status} and cannot be approved.`,
      );
    }

    // Only admins/owners may approve
    if (ctx!.role === 'viewer') {
      throw forbidden('Only admins and editors can approve proposals.');
    }

    // Resolve reviewer user row by email
    const [reviewer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.reviewerEmail))
      .limit(1);

    const reviewedById = reviewer?.id ?? null;

    const [updated] = await db
      .update(proposals)
      .set({
        status: 'approved',
        reviewedBy: reviewedById,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, params.id))
      .returning();

    return Response.json({ success: true, proposal: updated });
  },
);
