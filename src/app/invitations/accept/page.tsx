/**
 * Invitation Acceptance Page
 * Handles accepting team invitations via token
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/quoth/Navbar';

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, session } = useAuth();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'auth-required'>(
    'loading'
  );
  const [error, setError] = useState('');
  const [projectSlug, setProjectSlug] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Invalid invitation link');
      return;
    }

    if (!user) {
      setStatus('auth-required');
      return;
    }

    acceptInvitation();
  }, [token, user, session]);

  async function acceptInvitation() {
    if (!session?.access_token || !token) return;

    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('success');
        setProjectSlug(data.project?.slug || '');
      } else {
        setStatus('error');
        setError(data.error || 'Failed to accept invitation');
      }
    } catch (err) {
      setStatus('error');
      setError('Failed to accept invitation');
    }
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
        <div className="glass-panel p-8 w-full max-w-md text-center">
          {status === 'loading' && (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 rounded-full bg-violet-spectral/20 mx-auto flex items-center justify-center animate-pulse">
                  <svg
                    className="w-8 h-8 text-violet-spectral"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="text-2xl font-bold font-cinzel mb-2">Accepting Invitation...</h1>
              <p className="text-gray-400">Please wait while we add you to the project.</p>
            </>
          )}

          {status === 'auth-required' && (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 rounded-full bg-amber-500/20 mx-auto flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="text-2xl font-bold font-cinzel mb-2">Sign In Required</h1>
              <p className="text-gray-400 mb-6">Please sign in to accept this invitation.</p>
              <div className="space-y-3">
                <Button
                  onClick={() =>
                    router.push(`/auth/login?redirectTo=/invitations/accept?token=${token}`)
                  }
                  className="w-full"
                >
                  Sign In
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/auth/signup?redirectTo=/invitations/accept?token=${token}`)
                  }
                  className="w-full"
                >
                  Create Account
                </Button>
              </div>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 mx-auto flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="text-2xl font-bold font-cinzel mb-2">Welcome to the Team!</h1>
              <p className="text-gray-400 mb-6">You've successfully joined the project.</p>
              <Button
                onClick={() =>
                  router.push(projectSlug ? `/dashboard/${projectSlug}/team` : '/dashboard')
                }
                className="w-full"
              >
                Go to Project
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mb-6">
                <div className="w-16 h-16 rounded-full bg-red-500/20 mx-auto flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              </div>
              <h1 className="text-2xl font-bold font-cinzel mb-2">Invitation Failed</h1>
              <p className="text-gray-400 mb-6">{error}</p>
              <Button onClick={() => router.push('/dashboard')} className="w-full">
                Go to Dashboard
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
          <div className="text-gray-400">Loading...</div>
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
