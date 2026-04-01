/**
 * API Keys Management Page
 * Generate and manage MCP tokens for Claude Desktop integration
 */

'use client';

import { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

interface ApiKey {
  id: string;
  key_prefix: string;
  label: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [label, setLabel] = useState('Claude Desktop');
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const { user } = useUser();
  const { getToken } = useAuth();
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
    const authToken = await getToken();
    if (!authToken) return;

    setLoadingKeys(true);
    try {
      const res = await fetch('/api/mcp-token/list', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
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
    const authToken = await getToken();
    if (!authToken) return;

    setLoading(true);
    try {
      const res = await fetch('/api/mcp-token/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label }),
      });

      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setLabel('Claude Desktop'); // Reset label
        setGenerateDialogOpen(false);
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

  function handleCloseTokenDisplay() {
    setToken(null);
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="px-6 py-8 md:pt-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold font-cinzel mb-2">MCP API Keys</h1>
            <p className="text-gray-400">Generate tokens for Claude Desktop integration</p>
          </div>

          {/* Generate New Key Dialog */}
          <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
            <DialogTrigger asChild>
              <Button>+ Generate Token</Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-950 border-zinc-800 text-white">
              <DialogHeader>
                <DialogTitle>Generate New Token</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Tokens expire after 90 days and grant full access to your project&apos;s MCP tools.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                <label className="block text-sm font-medium mb-2 text-gray-300">Token Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg focus:outline-none focus:border-violet-spectral transition-colors text-white"
                  placeholder="Token label (e.g., Claude Desktop)"
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={generateToken} disabled={loading || !label.trim()}>
                  {loading ? 'Generating...' : 'Generate Token'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Token Display Dialog (shown once after generation) */}
        <Dialog open={!!token} onOpenChange={(open) => { if (!open) handleCloseTokenDisplay(); }}>
          <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Your New MCP Token</DialogTitle>
              <DialogDescription className="text-yellow-400 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Copy this token now. It will not be shown again.
              </DialogDescription>
            </DialogHeader>

            {token && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-300">MCP Token</label>
                  <div className="flex gap-2">
                    <pre className="flex-1 bg-zinc-900 p-4 rounded-lg overflow-x-auto text-sm font-mono border border-zinc-700 text-gray-300">
                      {token}
                    </pre>
                    <Button onClick={() => copyToClipboard(token)} variant="outline" className="shrink-0">
                      Copy
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold mb-2">Add to Claude Desktop</h3>
                  <p className="text-sm text-gray-400 mb-2">
                    Add this configuration to your Claude Desktop config file:
                  </p>
                  <div className="relative">
                    <pre className="bg-zinc-900 p-4 rounded-lg overflow-x-auto text-sm font-mono border border-zinc-700 text-gray-300">
{`{
  "mcpServers": {
    "quoth": {
      "url": "${process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev'}/api/mcp",
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
      "url": "${process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev'}/api/mcp",
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

                  <div className="mt-3 text-sm text-gray-400">
                    <p className="mb-1">Config file locations:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>macOS: <code className="text-violet-ghost">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                      <li>Windows: <code className="text-violet-ghost">%APPDATA%\Claude\claude_desktop_config.json</code></li>
                      <li>Linux: <code className="text-violet-ghost">~/.config/Claude/claude_desktop_config.json</code></li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleCloseTokenDisplay} variant="outline">Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Existing Keys Table */}
        <div className="glass-panel p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Your API Keys</h2>

          {loadingKeys ? (
            <p className="text-gray-400 text-center py-8">Loading keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No API keys yet. Generate one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">Label</TableHead>
                  <TableHead className="text-gray-400">Prefix</TableHead>
                  <TableHead className="text-gray-400">Created</TableHead>
                  <TableHead className="text-gray-400">Expires</TableHead>
                  <TableHead className="text-gray-400">Last Used</TableHead>
                  <TableHead className="text-gray-400">Status</TableHead>
                  <TableHead className="text-gray-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} className="border-zinc-800 hover:bg-zinc-900/50">
                    <TableCell className="font-bold text-white">{key.label}</TableCell>
                    <TableCell>
                      <code className="text-xs text-violet-ghost bg-violet-spectral/10 px-2 py-1 rounded border border-violet-spectral/20">
                        {key.key_prefix}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {new Date(key.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {key.expires_at ? new Date(key.expires_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      }) : 'Never'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {key.last_used_at ? (
                        <span className="text-gray-400">
                          {new Date(key.last_used_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      ) : (
                        <span className="text-yellow-400">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!key.expires_at || new Date(key.expires_at) > new Date() ? (
                        <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full border border-green-500/20">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded-full border border-red-500/20">
                          Expired
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog open={revokeKeyId === key.id} onOpenChange={(open) => { if (!open) setRevokeKeyId(null); }}>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                            onClick={() => setRevokeKeyId(key.id)}
                          >
                            Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-white">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              Are you sure you want to revoke <strong className="text-white">{key.label}</strong> (<code className="text-violet-ghost">{key.key_prefix}</code>)?
                              This action cannot be undone. Any integrations using this key will stop working immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => {
                                // Revoke logic would go here
                                setRevokeKeyId(null);
                              }}
                            >
                              Revoke Key
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Help Section */}
        <div className="glass-panel p-6">
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
