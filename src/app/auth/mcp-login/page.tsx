/**
 * MCP OAuth Login Page
 *
 * Handles OAuth flow login. After successful auth, completes OAuth via POST.
 */

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSignIn, useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

function MCPLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'authorizing' | 'success'>('loading');
  const { signIn } = useSignIn();
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isOAuthFlow = searchParams.get('oauth') === '1';

  // Check if already logged in and auto-complete OAuth
  useEffect(() => {
    async function checkAuth() {
      if (user && isOAuthFlow) {
        setStatus('authorizing');
        await completeOAuth();
      } else if (user) {
        setStatus('ready');
      } else {
        setStatus('ready');
      }
    }
    checkAuth();
  }, [user, isOAuthFlow]);

  async function completeOAuth() {
    try {
      // POST to authorize endpoint to generate auth code
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        credentials: 'include',
      });

      if (res.redirected) {
        setStatus('success');
        // Use window.location.href for the redirect (critical!)
        window.location.href = res.url;
      } else if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to complete authorization');
        setStatus('ready');
      }
    } catch (err) {
      console.error('OAuth completion error:', err);
      setError('Failed to complete authorization');
      setStatus('ready');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!signIn) {
      setError('Sign-in service not available');
      setLoading(false);
      return;
    }

    try {
      // Clerk v7: two-step flow — create with identifier, then submit password
      const createResult = await signIn.create({ identifier: email });
      if (createResult.error) {
        setError(createResult.error.message || 'Invalid email');
        setLoading(false);
        return;
      }

      const passwordResult = await signIn.password({ password });
      if (passwordResult.error) {
        setError(passwordResult.error.message || 'Invalid password');
        setLoading(false);
        return;
      }

      // Session is set automatically by Clerk v7
      // After login, complete OAuth flow
      if (isOAuthFlow) {
        setStatus('authorizing');
        await completeOAuth();
      } else {
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: Array<{ message?: string }> };
      const message = clerkError.errors?.[0]?.message || 'Invalid email or password';
      setError(message);
      setLoading(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="text-gray-400">Checking authentication...</div>
      </div>
    );
  }

  if (status === 'authorizing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="glass-panel p-8 text-center">
          <div className="animate-pulse text-violet-spectral text-xl mb-2">Authorizing...</div>
          <p className="text-gray-400">Connecting Claude Code to Quoth</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="glass-panel p-8 text-center">
          <div className="text-green-400 text-xl mb-2">Success!</div>
          <p className="text-gray-400">Redirecting to Claude Code...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
      <div className="glass-panel p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-cinzel mb-2">
            {isOAuthFlow ? 'Authorize Claude Code' : 'Quoth Login'}
          </h1>
          <p className="text-gray-400">
            {isOAuthFlow
              ? 'Sign in to connect Claude Code with Quoth'
              : 'Sign in to your Quoth account'}
          </p>
        </div>

        {isOAuthFlow && (
          <div className="bg-violet-spectral/10 border border-violet-spectral/20 rounded-lg p-4 mb-6">
            <p className="text-sm text-violet-glow">
              Claude Code is requesting access to your knowledge base.
            </p>
          </div>
        )}

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
              disabled={loading}
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
              disabled={loading}
              minLength={8}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : isOAuthFlow ? 'Authorize & Connect' : 'Sign In'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Don't have an account?{' '}
            <Link
              href={isOAuthFlow ? `/auth/signup?redirectTo=/auth/mcp-login?oauth=1` : '/auth/signup'}
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

export default function MCPLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <MCPLoginForm />
    </Suspense>
  );
}
