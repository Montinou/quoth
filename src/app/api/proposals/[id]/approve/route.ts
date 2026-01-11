/**
 * Proposals API - Approve Endpoint
 * POST /api/proposals/:id/approve - Approve proposal and commit to GitHub
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { commitProposalToGitHub } from '@/lib/github';
import { sendApprovalNotification } from '@/lib/email';

const ApproveSchema = z.object({
  reviewerEmail: z.string().email('Invalid email address'),
  notes: z.string().optional()
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // 1. Validate request body
    const body = await request.json();
    const validation = ApproveSchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: 'Invalid request data', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { reviewerEmail } = validation.data;

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
        { error: `Cannot approve proposal with status: ${proposal.status}` },
        { status: 400 }
      );
    }

    // 4. Update status to 'approved'
    const { error: updateError } = await supabase
      .from('document_proposals')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerEmail
      })
      .eq('id', params.id);

    if (updateError) {
      throw new Error(`Failed to update proposal: ${updateError.message}`);
    }

    // 5. Commit to GitHub
    console.log(`Committing proposal ${params.id} to GitHub...`);
    const commitResult = await commitProposalToGitHub(proposal);

    // 6. Update with commit info or error
    if (commitResult.success) {
      await supabase
        .from('document_proposals')
        .update({
          status: 'applied',
          commit_sha: commitResult.sha,
          commit_url: commitResult.url,
          applied_at: new Date().toISOString()
        })
        .eq('id', params.id);

      // 7. Send email notification (fire and forget)
      sendApprovalNotification(
        { ...proposal, reviewed_by: reviewerEmail },
        commitResult
      ).catch((err) => console.error('Email notification failed:', err));

      return Response.json({
        success: true,
        message: 'Proposal approved and committed to GitHub',
        commit: {
          sha: commitResult.sha,
          url: commitResult.url
        }
      });
    } else {
      // Commit failed - mark as error
      await supabase
        .from('document_proposals')
        .update({
          status: 'error',
          rejection_reason: `GitHub commit failed: ${commitResult.error}`
        })
        .eq('id', params.id);

      return Response.json(
        {
          error: 'GitHub commit failed',
          details: commitResult.error
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in approve endpoint:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
