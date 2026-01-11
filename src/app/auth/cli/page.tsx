/**
 * CLI Authentication Page
 * Shows generated token for user to copy and paste into terminal
 * Similar to Claude Code's authentication flow
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Copy, Check, Terminal, ExternalLink } from 'lucide-react';

export default function CLIAuthPage() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // Redirect to login with return URL
        router.push('/auth/login?redirectTo=/auth/cli');
        return;
      }

      setUser({ id: user.id, email: user.email || '' });
      setLoading(false);
    }

    checkAuth();
  }, [router, supabase.auth]);

  async function generateToken() {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/mcp-token/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: `CLI: ${new Date().toLocaleDateString()}`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate token');
      }

      setToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setGenerating(false);
    }
  }

  async function copyToken() {
    if (!token) return;

    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
      <div className="glass-panel p-8 w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet-spectral/20 flex items-center justify-center border border-violet-spectral/30">
            <Terminal className="w-8 h-8 text-violet-spectral" />
          </div>
          <h1 className="text-2xl font-bold font-cinzel mb-2">CLI Authentication</h1>
          <p className="text-gray-400 text-sm">
            Generate a token to authenticate the Quoth CLI
          </p>
        </div>

        {/* User Info */}
        <div className="bg-charcoal/50 rounded-lg p-4 mb-6 border border-graphite/30">
          <p className="text-sm text-gray-400 mb-1">Authenticated as</p>
          <p className="text-white font-medium">{user?.email}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!token ? (
          <>
            {/* Generate Button */}
            <Button
              onClick={generateToken}
              disabled={generating}
              className="w-full mb-6"
              size="lg"
            >
              {generating ? 'Generating...' : 'Generate Token'}
            </Button>

            <div className="text-center text-sm text-gray-500">
              <p>This will create a new API key for CLI access.</p>
              <p>The token expires in 90 days.</p>
            </div>
          </>
        ) : (
          <>
            {/* Token Display */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Your Token
              </label>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={token}
                  className="w-full px-4 py-3 pr-12 bg-charcoal border border-graphite rounded-lg font-mono text-sm text-white"
                />
                <button
                  onClick={copyToken}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/5 rounded transition-colors"
                  title="Copy token"
                >
                  {copied ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <Copy className="w-5 h-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Copy Button */}
            <Button
              onClick={copyToken}
              className="w-full mb-6"
              size="lg"
              variant={copied ? 'default' : 'glass'}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Token
                </>
              )}
            </Button>

            {/* Instructions */}
            <div className="bg-charcoal/50 rounded-lg p-4 border border-graphite/30">
              <p className="text-sm text-gray-300 mb-3">
                Paste this token in your terminal when prompted:
              </p>
              <code className="block bg-obsidian rounded px-3 py-2 text-sm font-mono text-violet-ghost">
                Paste your token here: █
              </code>
            </div>

            {/* Security Notice */}
            <div className="mt-6 text-center text-xs text-gray-500">
              <p>⚠️ This token will only be shown once.</p>
              <p>Store it securely or generate a new one if lost.</p>
            </div>

            {/* Generate Another */}
            <div className="mt-6 text-center">
              <button
                onClick={() => setToken(null)}
                className="text-sm text-violet-spectral hover:text-violet-glow transition-colors"
              >
                Generate another token
              </button>
            </div>
          </>
        )}

        {/* Footer Links */}
        <div className="mt-8 pt-6 border-t border-graphite/30 flex justify-between text-sm">
          <Link
            href="/dashboard"
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1"
          >
            Dashboard
            <ExternalLink className="w-3 h-3" />
          </Link>
          <Link
            href="/dashboard/api-keys"
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1"
          >
            Manage API Keys
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
