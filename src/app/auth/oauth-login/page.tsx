/**
 * OAuth Login Page
 * 
 * Handles OAuth authorization flow login.
 * After successful login, redirects to OAuth callback with auth code.
 */

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

function OAuthLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const oauthState = searchParams.get('oauth_state');
  const clientState = searchParams.get('client_state');

  useEffect(() => {
    if (!oauthState) {
      setError('Invalid OAuth request. Missing state parameter.');
    }
  }, [oauthState]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Redirect to OAuth callback to generate auth code
      const callbackUrl = new URL('/api/oauth/callback', window.location.origin);
      callbackUrl.searchParams.set('oauth_state', oauthState || '');
      if (clientState) {
        callbackUrl.searchParams.set('client_state', clientState);
      }
      
      router.push(callbackUrl.toString());
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
      <div className="glass-panel p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-cinzel mb-2">Authorize Quoth</h1>
          <p className="text-gray-400">
            Sign in to connect Quoth with Claude Code
          </p>
        </div>

        <div className="bg-violet-spectral/10 border border-violet-spectral/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-violet-glow">
            🔐 Claude Code is requesting access to your Quoth account.
            After signing in, you'll be connected automatically.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
              placeholder="you@example.com"
              required
              disabled={loading || !oauthState}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
              placeholder="••••••••"
              required
              disabled={loading || !oauthState}
              minLength={8}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !oauthState}>
            {loading ? 'Authorizing...' : 'Authorize & Connect'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Don't have an account?{' '}
            <Link
              href={`/auth/signup?redirectTo=${encodeURIComponent(`/auth/oauth-login?oauth_state=${oauthState}&client_state=${clientState || ''}`)}`}
              className="text-violet-spectral hover:text-violet-glow transition-colors"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function OAuthLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <OAuthLoginForm />
    </Suspense>
  );
}
