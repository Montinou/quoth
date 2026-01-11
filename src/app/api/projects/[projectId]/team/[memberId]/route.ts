/**
 * Member Management API
 * PATCH /api/projects/:projectId/team/:memberId - Update member role
 * DELETE /api/projects/:projectId/team/:memberId - Remove member
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';

const UpdateRoleSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; memberId: string }> }
) {
  try {
    const { projectId, memberId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate and verify admin
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: adminMembership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!adminMembership || adminMembership.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // 2. Validate request
    const body = await request.json();
    const validation = UpdateRoleSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // 3. Get target member info
    const { data: targetMember } = await supabase
      .from('project_members')
      .select('role, user_id')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .single();

    if (!targetMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // 4. Prevent demoting last admin
    if (validation.data.role !== 'admin' && targetMember.role === 'admin') {
      const { count } = await supabase
        .from('project_members')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('role', 'admin');

      if (count === 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last admin. Assign another admin first.' },
          { status: 400 }
        );
      }
    }

    // 5. Update role
    const { error: updateError } = await supabase
      .from('project_members')
      .update({ role: validation.data.role })
      .eq('id', memberId)
      .eq('project_id', projectId);

    if (updateError) {
      console.error('Failed to update role:', updateError);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Member PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; memberId: string }> }
) {
  try {
    const { projectId, memberId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get target member info
    const { data: targetMember } = await supabase
      .from('project_members')
      .select('user_id, role')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .single();

    if (!targetMember) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // 3. Check permissions (admin can remove anyone, users can remove themselves)
    const { data: currentMembership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    const isAdmin = currentMembership?.role === 'admin';
    const isSelf = targetMember.user_id === user.id;

    if (!isAdmin && !isSelf) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // 4. Prevent removing last admin
    if (targetMember.role === 'admin') {
      const { count } = await supabase
        .from('project_members')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('role', 'admin');

      if (count === 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin. Transfer ownership first.' },
          { status: 400 }
        );
      }
    }

    // 5. Remove member
    const { error: deleteError } = await supabase
      .from('project_members')
      .delete()
      .eq('id', memberId);

    if (deleteError) {
      console.error('Failed to remove member:', deleteError);
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Member DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
