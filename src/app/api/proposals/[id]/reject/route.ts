/**
 * /api/proposals/[id]/reject
 *   POST — Reject a pending proposal.
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

const rejectBody = z.object({
  reviewerEmail: z.string().email(),
  reason: z.string().min(1).max(1024),
});

// ---------------------------------------------------------------------------
// POST /api/proposals/:id/reject
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: rejectBody },
  },
  async (_req, ctx, params) => {
    const body = _req.validatedBody as z.infer<typeof rejectBody>;
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
        `Proposal is already ${proposal.status} and cannot be rejected.`,
      );
    }

    // Only admins/owners may reject
    if (ctx!.role === 'viewer') {
      throw forbidden('Only admins and editors can reject proposals.');
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
        status: 'rejected',
        reviewedBy: reviewedById,
        reasoning: body.reason,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, params.id))
      .returning();

    return Response.json({ success: true, proposal: updated });
  },
);
