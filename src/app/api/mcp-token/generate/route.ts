/**
 * MCP Token Generation API
 * Generates JWT tokens for MCP authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SignJWT } from 'jose';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
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
      return NextResponse.json(
        { error: 'No default project found. Please verify your account.' },
        { status: 400 }
      );
    }

    // 3. Verify user has admin/editor role
    let { data: membership, error: membershipError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', profile.default_project_id)
      .eq('user_id', user.id)
      .single();

    // Auto-create missing membership if user owns this project
    if (membershipError || !membership) {
      console.log(`[Token Gen] Creating missing membership for user ${user.id} in project ${profile.default_project_id}`);

      // Create membership as admin (user owns their default project)
      const { data: newMembership, error: createError } = await supabase
        .from('project_members')
        .insert({
          project_id: profile.default_project_id,
          user_id: user.id,
          role: 'admin'
        })
        .select('role')
        .single();

      if (createError) {
        console.error('[Token Gen] Failed to create membership:', createError);
        return NextResponse.json(
          { error: 'You are not a member of this project' },
          { status: 403 }
        );
      }

      membership = newMembership;
      console.log(`[Token Gen] Successfully created admin membership for user ${user.id}`);
    }

    if (membership.role === 'viewer') {
      return NextResponse.json(
        { error: 'Only admins and editors can generate tokens' },
        { status: 403 }
      );
    }

    // 4. Parse request body
    const body = await req.json();
    const { label } = body;

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return NextResponse.json(
        { error: 'Label is required' },
        { status: 400 }
      );
    }

    // 5. Generate JWT
    const jti = crypto.randomUUID();
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 90 * 24 * 60 * 60; // 90 days

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set in environment variables');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const token = await new SignJWT({
      project_id: profile.default_project_id,
      user_id: user.id,
      role: membership.role,
      label: label.trim(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev')
      .setSubject(profile.default_project_id)
      .setAudience('mcp-server')
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(jti)
      .sign(secret);

    // 6. Store hashed token in database
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    const keyPrefix = token.substring(0, 12) + '...';

    const { error: insertError } = await supabase.from('project_api_keys').insert({
      id: jti,
      project_id: profile.default_project_id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: label.trim(),
      expires_at: new Date((now + expiresIn) * 1000).toISOString(),
    });

    if (insertError) {
      console.error('Failed to store API key:', insertError);
      return NextResponse.json(
        { error: 'Failed to store API key' },
        { status: 500 }
      );
    }

    // 7. Return token to client
    return NextResponse.json({ token });
  } catch (error) {
    console.error('Token generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
