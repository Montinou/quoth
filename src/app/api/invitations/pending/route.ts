/**
 * Pending Invitations API
 * GET /api/invitations/pending - List user's pending invitations
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase as serviceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    if (!profile?.email) {
      return NextResponse.json({ invitations: [] });
    }

    // 3. Fetch pending invitations for user's email using service role
    const { data: invitations, error } = await serviceSupabase
      .from('project_invitations')
      .select(
        `
        id,
        role,
        created_at,
        expires_at,
        token,
        project_id,
        invited_by
      `
      )
      .eq('email', profile.email.toLowerCase())
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch pending invitations:', error);
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    // 4. Get project and inviter details
    const projectIds = [...new Set(invitations?.map((i) => i.project_id).filter(Boolean))];
    const inviterIds = [...new Set(invitations?.map((i) => i.invited_by).filter(Boolean))];

    let projects: Record<string, { id: string; slug: string }> = {};
    let inviters: Record<string, string> = {};

    if (projectIds.length > 0) {
      const { data: projectData } = await serviceSupabase
        .from('projects')
        .select('id, slug')
        .in('id', projectIds);

      projects = (projectData || []).reduce(
        (acc, p) => {
          acc[p.id] = { id: p.id, slug: p.slug };
          return acc;
        },
        {} as Record<string, { id: string; slug: string }>
      );
    }

    if (inviterIds.length > 0) {
      const { data: inviterData } = await serviceSupabase
        .from('profiles')
        .select('id, username')
        .in('id', inviterIds);

      inviters = (inviterData || []).reduce(
        (acc, p) => {
          acc[p.id] = p.username;
          return acc;
        },
        {} as Record<string, string>
      );
    }

    // 5. Map invitations with project and inviter info
    const enrichedInvitations = (invitations || []).map((inv) => ({
      id: inv.id,
      role: inv.role,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      token: inv.token,
      project: projects[inv.project_id] || null,
      inviter: inv.invited_by ? { username: inviters[inv.invited_by] } : null,
    }));

    return NextResponse.json({ invitations: enrichedInvitations });
  } catch (error) {
    console.error('Pending invitations error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
