/**
 * API Keys Management Page
 * Generate and manage MCP tokens for Claude Desktop integration
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface ApiKey {
  id: string;
  key_prefix: string;
  label: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [label, setLabel] = useState('Claude Desktop');
  const { session, user } = useAuth();
  const { success, error: showError } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.push('/auth/login?redirectTo=/dashboard/api-keys');
    } else {
      fetchKeys();
    }
  }, [user, router]);

  async function fetchKeys() {
    if (!session?.access_token) return;

    setLoadingKeys(true);
    try {
      const res = await fetch('/api/mcp-token/list', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (error) {
      console.error('Failed to fetch keys:', error);
    } finally {
      setLoadingKeys(false);
    }
  }

  async function generateToken() {
    if (!session?.access_token) return;

    setLoading(true);
    try {
      const res = await fetch('/api/mcp-token/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label }),
      });

      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setLabel('Claude Desktop'); // Reset label
        fetchKeys(); // Refresh keys list
      } else {
        const errorData = await res.json();
        showError('Failed to generate token', errorData.error);
      }
    } catch {
      showError('Failed to generate token', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    success('Copied to clipboard');
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="px-6 py-8 md:pt-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold font-cinzel mb-2">MCP API Keys</h1>
          <p className="text-gray-400">Generate tokens for Claude Desktop integration</p>
        </div>

        {/* Generate New Token Section */}
        <div className="glass-panel p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Generate New Token</h2>
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1 px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
              placeholder="Token label (e.g., Claude Desktop)"
            />
            <Button onClick={generateToken} disabled={loading || !label.trim()}>
              {loading ? 'Generating...' : '+ Generate Token'}
            </Button>
          </div>
          <p className="text-sm text-gray-500">
            Tokens expire after 90 days and grant full access to your project's MCP tools.
          </p>
        </div>

        {/* Token Display (shown once) */}
        {token && (
          <div className="glass-panel p-6 mb-8 border-violet-spectral">
            <div className="mb-4">
              <p className="text-sm text-yellow-400 mb-2 flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                Copy this token now. It will not be shown again.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Your MCP Token</label>
              <div className="flex gap-2">
                <pre className="flex-1 bg-charcoal p-4 rounded-lg overflow-x-auto text-sm font-mono border border-graphite">
                  {token}
                </pre>
                <Button onClick={() => copyToClipboard(token)} variant="outline">
                  Copy
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-bold mb-3">Add to Claude Desktop</h3>
              <p className="text-sm text-gray-400 mb-3">
                Add this configuration to your Claude Desktop config file:
              </p>
              <div className="relative">
                <pre className="bg-charcoal p-4 rounded-lg overflow-x-auto text-sm font-mono border border-graphite">
{`{
  "mcpServers": {
    "quoth": {
      "url": "${process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site'}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`}
                </pre>
                <Button
                  onClick={() => copyToClipboard(`{
  "mcpServers": {
    "quoth": {
      "url": "${process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site'}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`)}
                  className="absolute top-2 right-2"
                  variant="outline"
                  size="sm"
                >
                  Copy Config
                </Button>
              </div>

              <div className="mt-4 text-sm text-gray-400">
                <p className="mb-2">Config file locations:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>macOS: <code className="text-violet-ghost">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                  <li>Windows: <code className="text-violet-ghost">%APPDATA%\Claude\claude_desktop_config.json</code></li>
                  <li>Linux: <code className="text-violet-ghost">~/.config/Claude/claude_desktop_config.json</code></li>
                </ul>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-graphite">
              <Button onClick={() => setToken(null)} variant="outline">
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Existing Keys List */}
        <div className="glass-panel p-6">
          <h2 className="text-xl font-bold mb-4">Your API Keys</h2>

          {loadingKeys ? (
            <p className="text-gray-400 text-center py-8">Loading keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No API keys yet. Generate one above to get started.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="bg-charcoal/50 rounded-lg p-4 border border-graphite hover:border-violet-spectral/30 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold">{key.label}</h3>
                        <code className="text-xs text-violet-ghost bg-violet-spectral/10 px-2 py-1 rounded border border-violet-spectral/20">
                          {key.key_prefix}
                        </code>
                      </div>
                      <div className="text-sm text-gray-400 space-y-1">
                        <p>
                          Created: {new Date(key.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <p>
                          Expires: {new Date(key.expires_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        {key.last_used_at && (
                          <p>
                            Last used: {new Date(key.last_used_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                        {!key.last_used_at && (
                          <p className="text-yellow-400">Never used</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {new Date(key.expires_at) > new Date() ? (
                        <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded-full border border-red-500/20">
                          Expired
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Help Section */}
        <div className="mt-8 glass-panel p-6">
          <h2 className="text-xl font-bold mb-4">Need Help?</h2>
          <div className="space-y-4 text-sm text-gray-400">
            <div>
              <h3 className="font-bold text-white mb-2">What are MCP tokens?</h3>
              <p>
                MCP tokens allow Claude Desktop to securely access your Quoth knowledge base through the Model Context Protocol.
                Each token is associated with your user account and default project.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-2">How do I use a token?</h3>
              <p>
                Copy the generated token and add it to your Claude Desktop configuration file as shown above.
                Restart Claude Desktop after updating the config.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-white mb-2">Security best practices</h3>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Never share your tokens publicly</li>
                <li>Generate separate tokens for different devices</li>
                <li>Rotate tokens regularly (they expire after 90 days)</li>
                <li>Delete unused tokens immediately</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
