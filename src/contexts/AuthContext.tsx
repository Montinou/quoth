/**
 * Auth hooks for Quoth — powered by Clerk
 *
 * useProfile() fetches the DB profile (display_name, avatar_url, default_project_id)
 * for the current Clerk user. Uses SWR-style caching with localStorage.
 *
 * For auth state, use Clerk hooks directly:
 *   - useUser() for user object
 *   - useAuth() for session/token access
 *   - useClerk() for signOut, openSignIn, etc.
 */

'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';

// ── Profile type (matches public.users table) ─────────────────────
export interface Profile {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  defaultOrgId: string | null;
  defaultProjectId: string | null;
}

const PROFILE_CACHE_KEY = 'quoth_profile_cache';

// ── Profile Context ────────────────────────────────────────────────
interface ProfileContextType {
  profile: Profile | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  profileLoading: true,
  refreshProfile: async () => {},
});

export function useProfile() {
  return useContext(ProfileContext);
}

// ── Provider ───────────────────────────────────────────────────────
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [profileLoading, setProfileLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      localStorage.removeItem(PROFILE_CACHE_KEY);
      return;
    }

    try {
      const res = await fetch('/api/v1/profile');
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
      }
    } catch {
      // Use cached or null — non-critical
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoaded) {
      fetchProfile();
    }
  }, [isLoaded, user?.id, fetchProfile]);

  return (
    <ProfileContext.Provider value={{ profile, profileLoading, refreshProfile: fetchProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

// ── Legacy export (backwards compat during migration) ──────────────
// Components that imported useAuth() can now import useProfile() instead.
// This re-export prevents import errors during incremental migration.
export { useProfile as useAuth };
export { ProfileProvider as AuthProvider };
