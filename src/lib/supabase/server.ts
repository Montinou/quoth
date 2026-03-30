/**
 * Server Supabase Client
 * For use in server components, API routes, and middleware
 * Uses ANON key and manages auth via cookies with proper Next.js integration
 */

import { cookies } from 'next/headers'

/**
 * Create a server-side Supabase client with cookie-based auth.
 * Returns null when Supabase env vars are not configured (Neon + Clerk migration).
 */
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createServerClient } = require('@supabase/ssr')
  const cookieStore = await cookies()

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
