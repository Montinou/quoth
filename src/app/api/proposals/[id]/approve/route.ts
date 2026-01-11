/**
 * Proposals API - Approve Endpoint
 * POST /api/proposals/:id/approve - Approve proposal and apply to knowledge base
 * Requires authentication and admin role
 */

import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/supabase';
import { syncDocument } from '@/lib/sync';
import { sendApprovalNotification } from '@/lib/email';

const ApproveSchema = z.object({
  notes: z.string().optional()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      .eq('id', id)
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
      .eq('id', id);

    if (updateError) {
      throw new Error(`Failed to update proposal: ${updateError.message}`);
    }

    // 8. Apply changes directly to Supabase and re-index
    try {
      const title = proposal.file_path.replace('.md', '').split('/').pop() || proposal.file_path;
      
      const { document, chunksIndexed, chunksReused } = await syncDocument(
        proposal.project_id,
        proposal.file_path,
        title,
        proposal.proposed_content
      );

      await supabase
        .from('document_proposals')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString()
        })
        .eq('id', id);

      // Send email notification (fire and forget)
      sendApprovalNotification({ ...proposal, reviewed_by: profile.email })
        .catch((err) => console.error('Email notification failed:', err));

      return Response.json({
        success: true,
        message: 'Proposal approved and applied to knowledge base',
        document: { 
          id: document.id, 
          version: document.version, 
          chunksIndexed,
          chunksReused 
        }
      });
    } catch (error) {
      // Apply failed - mark as error
      await supabase
        .from('document_proposals')
        .update({
          status: 'error',
          rejection_reason: `Apply failed: ${error instanceof Error ? error.message : 'Unknown'}`
        })
        .eq('id', id);

      return Response.json(
        { error: 'Failed to apply changes' },
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
