/**
 * Next.js Middleware — Clerk Authentication + Route Protection
 *
 * Clerk auth middleware.
 *
 * Public routes:
 *   - /api/webhooks/clerk (Clerk webhook endpoint)
 *   - /api/v1/health (health check)
 *   - /api/mcp/* (MCP endpoints have their own auth layer)
 *   - /landing, /manifesto, /protocol, /guide, /pricing (marketing pages)
 *   - Static assets, favicons, .well-known
 *
 * Protected routes: everything else (Clerk session required)
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Route Matchers ──────────────────────────────────────────────

const isPublicRoute = createRouteMatcher([
  // Webhooks & health
  '/api/webhooks/clerk(.*)',
  '/api/v1/health(.*)',
  // MCP has its own auth (JWT / API key)
  '/api/mcp(.*)',
  // OAuth / auth flows
  '/api/auth/(.*)',
  '/api/oauth/(.*)',
  '/auth/(.*)',
  '/.well-known/(.*)',
  // Marketing / public pages
  '/',
  '/landing(.*)',
  '/manifesto(.*)',
  '/protocol(.*)',
  '/guide(.*)',
  '/pricing(.*)',
  '/docs(.*)',
  '/blog(.*)',
  '/changelog(.*)',
  '/terms(.*)',
  '/onboarding(.*)',
  // Sign-in / sign-up (Clerk hosted components)
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

// AI crawler user agents for GEO tracking (preserved from old middleware)
const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'CCBot', 'Perplexity', 'OAI-SearchBot', 'Google-Extended'];

// Public pages for cache headers
const PUBLIC_PAGES = ['/', '/landing', '/manifesto', '/protocol', '/guide', '/pricing'];

// Protected paths for X-Robots-Tag
const NOINDEX_PATHS = ['/dashboard', '/api/', '/auth/', '/invitations/'];

// ─── Middleware ──────────────────────────────────────────────────

export default clerkMiddleware(async (auth, request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // ── AI Bot Detection (GEO analytics) ──────────────────────────
  const userAgent = request.headers.get('user-agent') || '';
  const isAiBot = AI_CRAWLERS.some((bot) => userAgent.includes(bot));
  if (isAiBot) {
    console.log(`[AI-CRAWLER] ${userAgent.split('/')[0]} -> ${pathname}`);
  }

  // ── Redirect authenticated users from / to /dashboard ──────────
  // Use auth() (not protect()) — don't force login on the landing page.
  if (pathname === '/') {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // ── Public routes: no auth required ───────────────────────────
  if (isPublicRoute(request)) {
    const response = NextResponse.next();

    // Cache headers for public marketing pages
    if (PUBLIC_PAGES.includes(pathname)) {
      response.headers.set(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400',
      );
    }

    return response;
  }

  // ── Protected routes: require Clerk session ───────────────────
  await auth.protect();

  const response = NextResponse.next();

  // X-Robots-Tag for protected content
  if (NOINDEX_PATHS.some((p) => pathname.startsWith(p))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return response;
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - Static assets (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
