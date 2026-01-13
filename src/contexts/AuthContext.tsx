/**
 * Authentication Context
 * Manages user authentication state, session, and profile
 * Uses Supabase Auth with cookie-based sessions
 * 
 * Session refresh is handled by middleware - this context only tracks state
 */

'use client';

import { createContext, useContext, useEffect, useState, useRef } from 'react';
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
  profileLoading: boolean;
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
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [supabase] = useState(() => createClient());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    // Initialize auth state - optimized for fast anonymous experience
    const initAuth = async () => {
      try {
        // Step 1: Quick local check (no network request)
        // getSession() reads from cookies/storage - instant
        const { data: { session: localSession } } = await supabase.auth.getSession();

        if (!mounted) return;

        // No local session = definitely not logged in, done instantly
        if (!localSession) {
          setLoading(false);
          return;
        }

        // Step 2: We have a local session, validate it with server
        // This also handles token refresh automatically
        const { data: { user }, error } = await supabase.auth.getUser();

        if (!mounted) return;

        if (error || !user) {
          // Session was invalid/expired and couldn't refresh
          // Clear local state and continue as anonymous
          setLoading(false);
          return;
        }

        // Valid session - set user and fetch profile
        setUser(user);
        setSession(localSession);

        // Create abort controller for initial fetch
        abortControllerRef.current = new AbortController();
        await fetchProfile(user.id, abortControllerRef.current.signal);

        if (mounted) {
          setLoading(false);
        }
      } catch (err) {
        console.error('[AuthContext] Auth init error:', err);
        // On error, assume no session and continue
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        // Abort any in-flight profile fetch
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Create new abort controller for this fetch
          abortControllerRef.current = new AbortController();
          await fetchProfile(session.user.id, abortControllerRef.current.signal);
        } else {
          setProfile(null);
          setProfileLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
      // Abort any in-flight profile fetch on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [supabase]);

  // Note: Focus refresh removed - middleware handles session refresh

  async function fetchProfile(userId: string, abortSignal?: AbortSignal) {
    try {
      setProfileLoading(true);
      setProfileError(null);

      // Check if aborted before fetching
      if (abortSignal?.aborted) return;

      // Verify session is still valid before fetching
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession || currentSession.user?.id !== userId) {
        console.log('[AuthContext] Session changed, aborting profile fetch');
        return;
      }

      if (abortSignal?.aborted) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Check if aborted after fetching
      if (abortSignal?.aborted) return;

      if (error) {
        console.error('[AuthContext] Profile fetch error:', error);
        setProfileError(error.message);
        return;
      }

      if (data) {
        setProfile(data as Profile);
      }
    } catch (err) {
      if (abortSignal?.aborted) return;
      console.error('[AuthContext] Failed to load profile:', err);
      setProfileError('Failed to load profile');
    } finally {
      if (!abortSignal?.aborted) {
        setProfileLoading(false);
      }
    }
  }

  async function signUp(email: string, password: string, username: string) {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
          // Full URL where user should land after callback verification
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        console.error('[AuthContext] SignUp error:', error);
        return { error };
      }
      
      return { error: null };
    } catch (err) {
       console.error('[AuthContext] Unexpected SignUp error:', err);
       return { error: err as Error };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
         console.error('[AuthContext] Main signIn error:', error);
      }
      return { error: error as Error | null };
    } catch (err) {
      return { error: err as Error };
    }
  }

  async function signOut() {
    try {
      // Abort any in-flight profile fetch
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setSession(null);
      setProfileLoading(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
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
    profileLoading,
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
