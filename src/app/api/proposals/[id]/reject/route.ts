/**
 * Proposals API - Reject Endpoint
 * POST /api/proposals/:id/reject - Reject proposal with reason
 * Requires authentication and admin role
 */

import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/supabase';
import { sendRejectionNotification } from '@/lib/email';

const RejectSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters')
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
    const validation = RejectSchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: 'Invalid request data', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { reason } = validation.data;

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
        { error: 'Only admins can reject proposals.' },
        { status: 403 }
      );
    }

    // 6. Validate status
    if (proposal.status !== 'pending') {
      return Response.json(
        { error: `Cannot reject proposal with status: ${proposal.status}` },
        { status: 400 }
      );
    }

    // 7. Update status to 'rejected'
    const { error: updateError } = await supabase
      .from('document_proposals')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.email
      })
      .eq('id', params.id);

    if (updateError) {
      throw new Error(`Failed to update proposal: ${updateError.message}`);
    }

    // 8. Send email notification (fire and forget)
    sendRejectionNotification(
      { ...proposal, reviewed_by: profile.email },
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
