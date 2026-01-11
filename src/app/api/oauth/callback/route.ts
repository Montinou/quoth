/**
 * OAuth Callback Handler
 * 
 * Handles the callback after Supabase authentication,
 * generates authorization code, and redirects back to Claude.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { decodeState, encodeAuthCode } from '@/lib/auth/oauth-state';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const oauthStateToken = url.searchParams.get('oauth_state');
  const clientState = url.searchParams.get('client_state');
  const error = url.searchParams.get('error');
  
  if (error) {
    return NextResponse.json(
      { error: 'access_denied', error_description: 'User denied access' },
      { status: 400 }
    );
  }

  if (!oauthStateToken) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing oauth_state' },
      { status: 400 }
    );
  }

  // Decode and validate OAuth state from JWT
  const state = await decodeState(oauthStateToken);
  if (!state) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid or expired oauth_state' },
      { status: 400 }
    );
  }

  // Get the authenticated user from Supabase session
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: 'access_denied', error_description: 'Authentication failed' },
      { status: 401 }
    );
  }

  // Get user's default project and role
  const { data: profile } = await supabase
    .from('profiles')
    .select('default_project_id')
    .eq('id', user.id)
    .single();

  const projectId = profile?.default_project_id || `${user.email?.split('@')[0]}-knowledge-base`;

  // Get user's role for this project
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  const role = membership?.role || 'viewer';

  // Generate authorization code as JWT (encodes all necessary info)
  const authorizationCode = await encodeAuthCode({
    client_id: state.client_id,
    redirect_uri: state.redirect_uri,
    code_challenge: state.code_challenge,
    code_challenge_method: state.code_challenge_method,
    user_id: user.id,
    project_id: projectId,
    role: role,
    created_at: Date.now(),
  });

  // Redirect back to client with authorization code
  const redirectUrl = new URL(state.redirect_uri);
  redirectUrl.searchParams.set('code', authorizationCode);
  if (clientState) {
    redirectUrl.searchParams.set('state', clientState);
  }

  return NextResponse.redirect(redirectUrl.toString());
}
