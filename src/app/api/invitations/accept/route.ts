/**
 * Accept Invitation API
 * POST /api/invitations/accept - Accept invitation with token
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase as serviceSupabase } from '@/lib/supabase';
import { z } from 'zod';

const AcceptSchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Please sign in to accept the invitation' },
        { status: 401 }
      );
    }

    // 2. Validate request
    const body = await request.json();
    const validation = AcceptSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    // 3. Find valid invitation using service role
    const { data: invitation, error: inviteError } = await serviceSupabase
      .from('project_invitations')
      .select('*')
      .eq('token', validation.data.token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteError || !invitation) {
      return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 404 });
    }

    // 4. Verify email matches
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    if (profile?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'This invitation was sent to a different email address' },
        { status: 403 }
      );
    }

    // 5. Check if already a member
    const { data: existingMember } = await serviceSupabase
      .from('project_members')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', user.id)
      .single();

    if (existingMember) {
      // Clean up invitation and return success
      await serviceSupabase.from('project_invitations').delete().eq('id', invitation.id);

      return NextResponse.json({
        success: true,
        message: 'You are already a member of this project',
      });
    }

    // 6. Add user as member using service role
    const { error: insertError } = await serviceSupabase.from('project_members').insert({
      project_id: invitation.project_id,
      user_id: user.id,
      role: invitation.role,
      invited_by: invitation.invited_by,
    });

    if (insertError) {
      console.error('Failed to add member:', insertError);
      return NextResponse.json({ error: 'Failed to join project' }, { status: 500 });
    }

    // 7. Delete invitation
    await serviceSupabase.from('project_invitations').delete().eq('id', invitation.id);

    // 8. Get project info for response
    const { data: project } = await serviceSupabase
      .from('projects')
      .select('slug')
      .eq('id', invitation.project_id)
      .single();

    return NextResponse.json({
      success: true,
      project: {
        id: invitation.project_id,
        slug: project?.slug,
      },
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
