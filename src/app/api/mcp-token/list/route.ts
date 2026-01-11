/**
 * MCP Token List API
 * Lists all API keys for the user's default project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
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

    // 2. Get user's default project
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('default_project_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.default_project_id) {
      return NextResponse.json({ keys: [] });
    }

    // 3. Fetch API keys for the project
    const { data: keys, error: keysError } = await supabase
      .from('project_api_keys')
      .select('id, key_prefix, label, created_at, expires_at, last_used_at')
      .eq('project_id', profile.default_project_id)
      .order('created_at', { ascending: false });

    if (keysError) {
      console.error('Failed to fetch API keys:', keysError);
      return NextResponse.json(
        { error: 'Failed to fetch API keys' },
        { status: 500 }
      );
    }

    return NextResponse.json({ keys: keys || [] });
  } catch (error) {
    console.error('List keys error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
