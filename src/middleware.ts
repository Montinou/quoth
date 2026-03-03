/**
 * Next.js Middleware for Session Management and Route Protection
 * Uses Supabase SSR with getClaims() for proper JWT validation
 *
 * Based on official Supabase proxy pattern:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// AI crawler user agents for GEO tracking
const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'CCBot', 'Perplexity', 'OAI-SearchBot', 'Google-Extended'];

// Public pages that should be cached and indexed
const PUBLIC_PAGES = ['/', '/landing', '/manifesto', '/protocol', '/guide', '/pricing'];

// Protected paths that should not be indexed
const PROTECTED_PATHS = ['/dashboard', '/api/', '/auth/', '/invitations/'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Create Supabase client with proper cookie handling
  // IMPORTANT: Always create a new client on each request
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not run code between createServerClient and getClaims()
  // This ensures proper token refresh before any auth checks

  // Use getUser() for now as getClaims() may not be available in current version
  // getUser() validates the JWT with Supabase Auth server
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // AI Bot Detection for GEO analytics
  const userAgent = request.headers.get('user-agent') || '';
  const isAiBot = AI_CRAWLERS.some(bot => userAgent.includes(bot));

  if (isAiBot) {
    // Log AI crawler access for analytics
    console.log(`[AI-CRAWLER] ${userAgent.split('/')[0]} → ${request.nextUrl.pathname}`);
  }

  // Add X-Robots-Tag for protected content
  const isProtectedPath = PROTECTED_PATHS.some(path =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (isProtectedPath) {
    supabaseResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // Cache-Control for public pages (helps AI bot caching)
  if (PUBLIC_PAGES.includes(request.nextUrl.pathname)) {
    supabaseResponse.headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }

  // Protected routes that require authentication
  const protectedRoutes = ['/dashboard', '/proposals', '/knowledge-base']
  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Public pages that should always be accessible (even for authenticated users)
  const alwaysPublicRoutes = ['/landing', '/manifesto', '/protocol', '/guide', '/pricing']
  const isAlwaysPublic = alwaysPublicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Redirect unauthenticated users to landing page
  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/landing'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users from root to dashboard (but not from /landing)
  if (request.nextUrl.pathname === '/' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Public pages are always accessible - no redirects
  if (isAlwaysPublic) {
    return supabaseResponse
  }

  // Redirect authenticated users away from auth pages (except specific pages)
  const authExceptions = [
    '/auth/mcp-login',
    '/auth/cli',
    '/auth/callback',
    '/auth/verify-email'
  ]
  const isAuthException = authExceptions.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (request.nextUrl.pathname.startsWith('/auth') && user && !isAuthException) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // The cookies have been properly set on this response object.
  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/mcp (MCP endpoints have their own auth)
     * - .well-known (OAuth discovery)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/mcp|api/auth/send-email|api/oauth|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
