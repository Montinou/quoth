/**
 * Signup Page
 * User registration with automatic project creation
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate username format
    if (!/^[a-z0-9-]+$/.test(username)) {
      setError('Username can only contain lowercase letters, numbers, and hyphens');
      setLoading(false);
      return;
    }

    const { error } = await signUp(email, password, username);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/auth/verify-email');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
      <div className="glass-panel p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold font-cinzel mb-2">Create Account</h1>
          <p className="text-gray-400">Join Quoth and build your knowledge base</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="w-full px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
              placeholder="john-doe"
              pattern="[a-z0-9-]+"
              required
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              Your project will be: <span className="text-violet-ghost">{username || 'username'}-knowledge-base</span>
            </p>
          </div>

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
              minLength={8}
              required
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              Minimum 8 characters
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Sign Up'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            Already have an account?{' '}
            <Link
              href="/auth/login"
              className="text-violet-spectral hover:text-violet-glow transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
