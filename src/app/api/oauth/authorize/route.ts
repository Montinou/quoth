/**
 * OAuth Authorization Endpoint
 * 
 * Handles the OAuth authorization flow:
 * 1. Validates client and PKCE parameters
 * 2. Encodes state as JWT and passes via URL
 * 3. Redirects to login page
 */

import { NextResponse } from 'next/server';
import { encodeState } from '@/lib/auth/oauth-state';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

export async function GET(req: Request) {
  const url = new URL(req.url);
  
  // Extract OAuth parameters
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
  const scope = url.searchParams.get('scope');

  // Validate required parameters
  if (!clientId) {
    return errorResponse('invalid_request', 'client_id is required');
  }
  if (!redirectUri) {
    return errorResponse('invalid_request', 'redirect_uri is required');
  }
  if (responseType !== 'code') {
    return errorResponse('unsupported_response_type', 'Only code response type is supported');
  }
  if (!codeChallenge) {
    return errorResponse('invalid_request', 'code_challenge is required (PKCE)');
  }
  if (codeChallengeMethod !== 'S256') {
    return errorResponse('invalid_request', 'Only S256 code_challenge_method is supported');
  }

  // Encode OAuth state as JWT (works on serverless!)
  const oauthStateToken = await encodeState({
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || undefined,
    created_at: Date.now(),
  });

  // Build the login page URL with encoded state
  const loginUrl = new URL(`${APP_URL}/auth/oauth-login`);
  loginUrl.searchParams.set('oauth_state', oauthStateToken);
  loginUrl.searchParams.set('client_state', state || '');
  
  return NextResponse.redirect(loginUrl.toString());
}

function errorResponse(error: string, description: string) {
  return NextResponse.json(
    { error, error_description: description },
    { status: 400 }
  );
}
