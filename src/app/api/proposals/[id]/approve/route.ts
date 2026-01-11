/**
 * Proposals API - Approve Endpoint
 * POST /api/proposals/:id/approve - Approve proposal and commit to GitHub
 * Requires authentication and admin role
 */

import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/supabase';
import { commitProposalToGitHub } from '@/lib/github';
import { sendApprovalNotification } from '@/lib/email';

const ApproveSchema = z.object({
  notes: z.string().optional()
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authSupabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get user profile for reviewer email
    const { data: profile, error: profileError } = await authSupabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return Response.json({ error: 'User profile not found' }, { status: 404 });
    }

    // 3. Validate request body
    const body = await request.json();
    const validation = ApproveSchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: 'Invalid request data', details: validation.error.errors },
        { status: 400 }
      );
    }

    // 4. Fetch proposal
    const { data: proposal, error: fetchError } = await supabase
      .from('document_proposals')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !proposal) {
      return Response.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // 5. Verify user is admin of the proposal's project
    const { data: membership, error: membershipError } = await authSupabase
      .from('project_members')
      .select('role')
      .eq('project_id', proposal.project_id)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return Response.json(
        { error: 'Access denied. You are not a member of this project.' },
        { status: 403 }
      );
    }

    if (membership.role !== 'admin') {
      return Response.json(
        { error: 'Only admins can approve proposals.' },
        { status: 403 }
      );
    }

    // 6. Validate status
    if (proposal.status !== 'pending') {
      return Response.json(
        { error: `Cannot approve proposal with status: ${proposal.status}` },
        { status: 400 }
      );
    }

    // 7. Update status to 'approved'
    const { error: updateError } = await supabase
      .from('document_proposals')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.email
      })
      .eq('id', params.id);

    if (updateError) {
      throw new Error(`Failed to update proposal: ${updateError.message}`);
    }

    // 8. Commit to GitHub
    console.log(`Committing proposal ${params.id} to GitHub...`);
    const commitResult = await commitProposalToGitHub(proposal);

    // 9. Update with commit info or error
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

      // 10. Send email notification (fire and forget)
      sendApprovalNotification(
        { ...proposal, reviewed_by: profile.email },
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
