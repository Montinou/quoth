/**
 * Next.js Middleware for Route Protection
 * Handles authentication state and redirects for protected routes
 * Uses Supabase Auth with cookie-based sessions
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // Get user session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes that require authentication
  const protectedRoutes = ['/dashboard', '/proposals'];
  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  // Redirect unauthenticated users to landing page
  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect authenticated users away from auth pages (except specific pages)
  // These pages need to work even if user is logged in:
  // - MCP/CLI login: for token generation
  // - Callback/verify: for email confirmation flow
  const authExceptions = [
    '/auth/mcp-login',
    '/auth/cli',
    '/auth/callback',
    '/auth/verify-email'
  ];
  const isAuthException = authExceptions.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (request.nextUrl.pathname.startsWith('/auth') && user && !isAuthException) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/proposals/:path*',
    '/auth/:path*',
  ],
};
