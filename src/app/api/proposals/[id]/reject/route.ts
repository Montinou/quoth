/**
 * Proposals API - Reject Endpoint
 * POST /api/proposals/:id/reject - Reject proposal with reason
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { sendRejectionNotification } from '@/lib/email';

const RejectSchema = z.object({
  reviewerEmail: z.string().email('Invalid email address'),
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters')
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 1. Validate request body
    const body = await request.json();
    const validation = RejectSchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: 'Invalid request data', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { reviewerEmail, reason } = validation.data;

    // 2. Fetch proposal
    const { data: proposal, error: fetchError } = await supabase
      .from('document_proposals')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !proposal) {
      return Response.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // 3. Validate status
    if (proposal.status !== 'pending') {
      return Response.json(
        { error: `Cannot reject proposal with status: ${proposal.status}` },
        { status: 400 }
      );
    }

    // 4. Update status to 'rejected'
    const { error: updateError } = await supabase
      .from('document_proposals')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerEmail
      })
      .eq('id', params.id);

    if (updateError) {
      throw new Error(`Failed to update proposal: ${updateError.message}`);
    }

    // 5. Send email notification (fire and forget)
    sendRejectionNotification(
      { ...proposal, reviewed_by: reviewerEmail },
      reason
    ).catch((err) => console.error('Email notification failed:', err));

    return Response.json({
      success: true,
      message: 'Proposal rejected'
    });
  } catch (error) {
    console.error('Error in reject endpoint:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
