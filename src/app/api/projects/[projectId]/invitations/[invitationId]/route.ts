/**
 * Single Invitation API
 * DELETE /api/projects/:projectId/invitations/:invitationId - Cancel invitation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase as serviceSupabase } from '@/lib/supabase';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; invitationId: string }> }
) {
  try {
    const { projectId, invitationId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate and verify admin
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // 2. Delete invitation using service role
    const { error: deleteError } = await serviceSupabase
      .from('project_invitations')
      .delete()
      .eq('id', invitationId)
      .eq('project_id', projectId);

    if (deleteError) {
      console.error('Failed to cancel invitation:', deleteError);
      return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Invitation DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
