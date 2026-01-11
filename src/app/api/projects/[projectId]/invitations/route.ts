/**
 * Invitations API
 * GET /api/projects/:projectId/invitations - List pending invitations
 * POST /api/projects/:projectId/invitations - Create new invitation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase as serviceSupabase } from '@/lib/supabase';
import { z } from 'zod';
import crypto from 'crypto';
import { sendTeamInvitationEmail } from '@/lib/email';

const InviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'editor', 'viewer']).default('viewer'),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
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

    // 2. Fetch pending invitations using service role to bypass RLS
    const { data: invitations, error } = await serviceSupabase
      .from('project_invitations')
      .select(
        `
        id,
        email,
        role,
        created_at,
        expires_at,
        invited_by
      `
      )
      .eq('project_id', projectId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch invitations:', error);
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    // 3. Get inviter profiles
    const inviterIds = [...new Set(invitations?.map((i) => i.invited_by).filter(Boolean))];
    let inviterProfiles: Record<string, string> = {};

    if (inviterIds.length > 0) {
      const { data: profiles } = await serviceSupabase
        .from('profiles')
        .select('id, username')
        .in('id', inviterIds);

      inviterProfiles = (profiles || []).reduce(
        (acc, p) => {
          acc[p.id] = p.username;
          return acc;
        },
        {} as Record<string, string>
      );
    }

    // 4. Map invitations with inviter names
    const invitationsWithInviter = (invitations || []).map((inv) => ({
      ...inv,
      inviter_username: inv.invited_by ? inviterProfiles[inv.invited_by] : null,
    }));

    return NextResponse.json({ invitations: invitationsWithInviter });
  } catch (error) {
    console.error('Invitations GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
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

    // 2. Validate request body
    const body = await request.json();
    const validation = InviteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { email, role } = validation.data;

    // 3. Check if user is already a member
    const { data: existingProfile } = await serviceSupabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (existingProfile) {
      const { data: existingMember } = await serviceSupabase
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', existingProfile.id)
        .single();

      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this project' },
          { status: 400 }
        );
      }
    }

    // 4. Check for existing pending invitation
    const { data: existingInvite } = await serviceSupabase
      .from('project_invitations')
      .select('id')
      .eq('project_id', projectId)
      .eq('email', email)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invitation has already been sent to this email' },
        { status: 400 }
      );
    }

    // 5. Generate invitation token and expiry (7 days)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 6. Get project details for email
    const { data: project } = await serviceSupabase
      .from('projects')
      .select('slug')
      .eq('id', projectId)
      .single();

    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();

    // 7. Create invitation using service role
    const { data: invitation, error: insertError } = await serviceSupabase
      .from('project_invitations')
      .insert({
        project_id: projectId,
        email,
        role,
        invited_by: user.id,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create invitation:', insertError);
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
    }

    // 8. Send invitation email (non-blocking)
    sendTeamInvitationEmail({
      email,
      projectName: project?.slug || 'Unknown Project',
      inviterName: inviterProfile?.username || 'A team member',
      role,
      token,
    }).catch((err) => console.error('Email notification failed:', err));

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email,
        role,
        expires_at: invitation.expires_at,
      },
    });
  } catch (error) {
    console.error('Invitations POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
