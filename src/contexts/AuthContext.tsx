/**
 * Authentication Context
 * Manages user authentication state, session, and profile
 * Uses Supabase Auth with cookie-based sessions
 * 
 * Session refresh is handled by middleware - this context only tracks state
 */

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  default_project_id?: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let mounted = true;

    // Initialize auth state
    const initAuth = async () => {
      try {
        console.log('[AuthContext] Initializing auth...', new Date().toISOString());
        console.log('[AuthContext] Debug info:', {
          envUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasCookie: typeof document !== 'undefined' ? document.cookie.length > 0 : 'N/A',
          sbCookiePresent: typeof document !== 'undefined' ? document.cookie.includes('sb-') : 'N/A'
        });
        
        // Use getUser() which validates JWT with Supabase Auth server
        const { data: { user }, error } = await supabase.auth.getUser();

        console.log('[AuthContext] getUser result:', { 
          hasUser: !!user, 
          userId: user?.id, 
          error: error?.message 
        });

        if (!mounted) return;

        if (error) {
          console.warn('[AuthContext] getUser failed:', error);
          
          // Debug: Check if session exists locally even if getUser failed
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          console.log('[AuthContext] Fallback getSession check:', {
             hasSession: !!session,
             error: sessionError?.message
          });

          setLoading(false);
          return;
        }

        if (user) {
          setUser(user);
          // Also get session for convenience
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          console.log('[AuthContext] getSession result:', { 
            hasSession: !!session,
            sessionError: sessionError?.message 
          });
          
          if (mounted) {
            setSession(session);
            await fetchProfile(user.id);
          }
        }
        
        if (mounted) {
          setLoading(false);
        }
      } catch (err) {
        console.error('[AuthContext] Unexpected error during init:', err);
        // Silently handle errors - middleware handles auth
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AuthContext] Auth state change:', event, !!session, new Date().toISOString());
        if (!mounted) return;

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Note: Focus refresh removed - middleware handles session refresh

  async function fetchProfile(userId: string) {
    try {
      setProfileError(null);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        setProfileError(error.message);
        return;
      }

      if (data) {
        setProfile(data as Profile);
      }
    } catch (err) {
      setProfileError('Failed to load profile');
    }
  }

  async function signUp(email: string, password: string, username: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    return { error: error as Error | null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (user) {
      await fetchProfile(user.id);
    }
  }

  const value = {
    user,
    profile,
    session,
    loading,
    profileError,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
