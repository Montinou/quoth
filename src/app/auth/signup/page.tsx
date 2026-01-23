/**
 * Signup Page
 * Elegant user registration with automatic project creation
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Mail, Lock, User, ArrowRight, Loader2, Sparkles, FolderOpen } from 'lucide-react';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian via-obsidian to-charcoal px-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-violet-spectral/10 rounded-full blur-3xl pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-violet-glow/10 rounded-full blur-3xl pointer-events-none animate-pulse-slow" style={{ animationDelay: '1s' }} />

      <div className="relative z-10 w-full max-w-md animate-page-enter">
        {/* Logo */}
        <div className="text-center mb-8 animate-stagger stagger-1">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-spectral to-violet-glow flex items-center justify-center shadow-lg shadow-violet-spectral/30 group-hover:shadow-xl group-hover:shadow-violet-spectral/40 transition-all">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
              </svg>
            </div>
            <span className="text-2xl font-bold text-white" style={{ fontFamily: "var(--font-cormorant), serif" }}>Quoth</span>
          </Link>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-2xl p-8 border border-violet-spectral/10 shadow-xl shadow-violet-spectral/5 animate-stagger stagger-2">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold font-cinzel mb-2 text-white">Create Account</h1>
            <p className="text-gray-400">Join Quoth and build your knowledge base</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 toast-enter">
              <p className="text-red-400 text-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                {error}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username Field */}
            <div className="animate-stagger stagger-3">
              <label htmlFor="username" className="block text-sm font-medium mb-2 text-gray-300">
                Username
              </label>
              <div
                className={`
                  relative rounded-xl transition-all duration-300
                  ${focusedField === 'username' ? 'ring-2 ring-violet-spectral/50 shadow-lg shadow-violet-spectral/10' : ''}
                `}
              >
                <User
                  className={`
                    absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-300
                    ${focusedField === 'username' ? 'text-violet-spectral' : 'text-gray-500'}
                  `}
                />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-12 pr-4 py-3.5 bg-charcoal/80 border border-graphite rounded-xl focus:outline-none focus:border-violet-spectral/50 transition-all duration-300 text-white placeholder:text-gray-500"
                  placeholder="john-doe"
                  pattern="[a-z0-9\-]+"
                  required
                  disabled={loading}
                />
              </div>
              {/* Project preview */}
              <div className="mt-2 px-3 py-2 rounded-lg bg-charcoal/50 border border-graphite/50">
                <p className="text-xs text-gray-500 flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5" />
                  Your project:
                  <span className="text-violet-ghost font-medium">{username || 'username'}-knowledge-base</span>
                </p>
              </div>
            </div>

            {/* Email Field */}
            <div className="animate-stagger stagger-4">
              <label htmlFor="email" className="block text-sm font-medium mb-2 text-gray-300">
                Email
              </label>
              <div
                className={`
                  relative rounded-xl transition-all duration-300
                  ${focusedField === 'email' ? 'ring-2 ring-violet-spectral/50 shadow-lg shadow-violet-spectral/10' : ''}
                `}
              >
                <Mail
                  className={`
                    absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-300
                    ${focusedField === 'email' ? 'text-violet-spectral' : 'text-gray-500'}
                  `}
                />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-12 pr-4 py-3.5 bg-charcoal/80 border border-graphite rounded-xl focus:outline-none focus:border-violet-spectral/50 transition-all duration-300 text-white placeholder:text-gray-500"
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="animate-stagger stagger-5">
              <label htmlFor="password" className="block text-sm font-medium mb-2 text-gray-300">
                Password
              </label>
              <div
                className={`
                  relative rounded-xl transition-all duration-300
                  ${focusedField === 'password' ? 'ring-2 ring-violet-spectral/50 shadow-lg shadow-violet-spectral/10' : ''}
                `}
              >
                <Lock
                  className={`
                    absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-300
                    ${focusedField === 'password' ? 'text-violet-spectral' : 'text-gray-500'}
                  `}
                />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  className="w-full pl-12 pr-4 py-3.5 bg-charcoal/80 border border-graphite rounded-xl focus:outline-none focus:border-violet-spectral/50 transition-all duration-300 text-white placeholder:text-gray-500"
                  placeholder="••••••••"
                  minLength={8}
                  required
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2 pl-1">
                Minimum 8 characters
              </p>
            </div>

            {/* Submit Button */}
            <div className="animate-stagger stagger-6 pt-2">
              <Button
                type="submit"
                disabled={loading}
                className="w-full py-6 text-base font-semibold rounded-xl bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral transition-all duration-300 shadow-lg shadow-violet-spectral/20 hover:shadow-xl hover:shadow-violet-spectral/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Create Account</span>
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Divider */}
          <div className="relative my-8 animate-stagger stagger-7">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-graphite"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-charcoal text-gray-500">Already have an account?</span>
            </div>
          </div>

          {/* Sign In Link */}
          <div className="text-center animate-stagger stagger-8">
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-2 text-violet-spectral hover:text-violet-ghost transition-colors group"
            >
              <span>Sign in instead</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-8 animate-stagger stagger-8">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="text-violet-spectral hover:text-violet-ghost transition-colors">
            Terms of Service
          </Link>
        </p>
      </div>
    </div>
  );
}
