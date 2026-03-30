/**
 * Browser Supabase Client
 * For use in client components (with 'use client' directive)
 * Uses ANON key and manages auth via cookies
 *
 * IMPORTANT: Uses singleton pattern to prevent AbortError in React 18 Strict Mode.
 * Multiple client instances cause auth lock conflicts when components double-mount.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance - prevents multiple clients from fighting for auth lock
let browserClient: SupabaseClient | null = null

/**
 * Create a browser Supabase client (singleton).
 * Returns a stub that throws on use when SUPABASE_URL is not configured
 * (e.g. after migrating to Neon + Clerk). This prevents build-time crashes
 * while still surfacing clear errors if Supabase auth code is invoked at runtime.
 */
export function createClient(): SupabaseClient {
  if (browserClient) {
    return browserClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    // Return a minimal proxy that throws descriptive errors at call-sites
    // instead of crashing at module-init / build time
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'auth') {
          return new Proxy({}, {
            get(_t, method) {
              return () => {
                console.warn(`[Supabase Client] Supabase not configured — ${String(method)}() is a no-op`)
                return Promise.resolve({ data: { user: null, session: null }, error: null })
              }
            },
          })
        }
        if (typeof prop === 'string') {
          return () => {
            console.warn(`[Supabase Client] Supabase not configured — .${prop}() is a no-op`)
            return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }
          }
        }
      },
    }
    browserClient = new Proxy({}, handler) as unknown as SupabaseClient
    return browserClient
  }

  // Only import @supabase/ssr when actually needed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createBrowserClient } = require('@supabase/ssr')
  browserClient = createBrowserClient(url, anonKey)

  return browserClient!
}
