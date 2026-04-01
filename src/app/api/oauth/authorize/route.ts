/**
 * OAuth Authorization Endpoint
 *
 * GET:  Validates params, stores request in cookie, redirects to Clerk login if needed.
 *       If already authenticated, issues auth code immediately.
 * POST: Called by /auth/mcp-login after successful Clerk login to generate auth code.
 *
 * Auth code is a self-contained JWT (no DB needed). The token endpoint verifies it.
 */

import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import { users, projectMembers } from '@/db/schema';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

interface StoredAuthRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
}

interface UserContext {
  user_id: string;
  project_id: string;
  role: 'admin' | 'editor' | 'viewer';
}

/**
 * Resolve project_id and role for an authenticated Clerk user via DB lookup.
 */
async function resolveUserContext(clerkUserId: string): Promise<UserContext | null> {
  try {
    const db = getDb();

    const [user] = await db
      .select({
        id: users.id,
        defaultProjectId: users.defaultProjectId,
      })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    // If user not in DB yet (empty DB), fall back to Clerk userId + no project
    if (!user) {
      return { user_id: clerkUserId, project_id: '', role: 'viewer' };
    }

    const projectId = user.defaultProjectId ?? '';

    let role: 'admin' | 'editor' | 'viewer' = 'viewer';
    if (projectId) {
      const [membership] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(eq(projectMembers.userId, user.id))
        .limit(1);
      if (membership?.role && ['admin', 'editor', 'viewer'].includes(membership.role)) {
        role = membership.role as 'admin' | 'editor' | 'viewer';
      }
    }

    return { user_id: user.id, project_id: projectId, role };
  } catch (err) {
    // DB unavailable or tables missing — fall back to Clerk userId
    console.error('[OAuth Authorize] DB lookup failed, using fallback:', err);
    return { user_id: clerkUserId, project_id: '', role: 'viewer' };
  }
}

/**
 * Issue a short-lived auth code JWT containing all data needed for token exchange.
 */
async function issueAuthCode(authRequest: StoredAuthRequest, ctx: UserContext): Promise<NextResponse> {
  const secret = getJwtSecret();

  const code = await new SignJWT({
    sub: ctx.project_id,
    user_id: ctx.user_id,
    role: ctx.role,
    client_id: authRequest.client_id,
    redirect_uri: authRequest.redirect_uri,
    code_challenge: authRequest.code_challenge,
    type: 'auth_code',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .setIssuer(APP_URL)
    .setAudience('mcp-oauth')
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.delete('mcp_oauth_request');

  const redirectUrl = new URL(authRequest.redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (authRequest.state) {
    redirectUrl.searchParams.set('state', authRequest.state);
  }

  return NextResponse.redirect(redirectUrl.toString());
}

/**
 * GET — initial authorization request from Claude Code
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const state = url.searchParams.get('state') ?? undefined;
  const responseType = url.searchParams.get('response_type');

  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      { status: 400, headers: corsHeaders }
    );
  }
  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type' },
      { status: 400, headers: corsHeaders }
    );
  }

  const authRequest: StoredAuthRequest = { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state };

  // Store in cookie so POST can retrieve it after login
  const cookieStore = await cookies();
  cookieStore.set('mcp_oauth_request', JSON.stringify(authRequest), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
  });

  // If user already has a Clerk session, issue code immediately
  const { userId } = await auth();
  if (userId) {
    const ctx = await resolveUserContext(userId);
    return issueAuthCode(authRequest, ctx);
  }

  // Otherwise redirect to MCP login page
  return NextResponse.redirect(new URL('/auth/mcp-login?oauth=1', APP_URL));
}

/**
 * POST — called by /auth/mcp-login after successful Clerk login
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('mcp_oauth_request')?.value;
    if (!raw) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'No pending OAuth request' },
        { status: 400 }
      );
    }

    const authRequest: StoredAuthRequest = JSON.parse(raw);

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'access_denied' }, { status: 401 });
    }

    const ctx = await resolveUserContext(userId);
    return issueAuthCode(authRequest, ctx);
  } catch (error) {
    console.error('[OAuth Authorize POST] Error:', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
