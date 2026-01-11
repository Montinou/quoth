/**
 * Team Management Page
 * Allows admins to invite users, manage members, and handle roles
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/quoth/Navbar';

interface Member {
  id: string;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
  profiles: {
    id: string;
    email: string;
    username: string;
    full_name?: string;
    avatar_url?: string;
  };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  inviter_username?: string;
}

export default function TeamPage() {
  const params = useParams();
  const router = useRouter();
  const { session, user } = useAuth();
  const projectSlug = params.projectSlug as string;

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);

  // Get project ID from slug
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      router.push(`/auth/login?redirectTo=/dashboard/${projectSlug}/team`);
      return;
    }
    fetchProjectAndData();
  }, [user, projectSlug]);

  async function fetchProjectAndData() {
    if (!session?.access_token) return;

    try {
      // First get project ID from slug
      const projectRes = await fetch(`/api/projects/by-slug/${projectSlug}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!projectRes.ok) {
        setError('Project not found');
        setLoading(false);
        return;
      }

      const { project } = await projectRes.json();
      setProjectId(project.id);
      setCurrentUserRole(project.userRole || '');

      // Fetch team members
      const teamRes = await fetch(`/api/projects/${project.id}/team`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (teamRes.ok) {
        const data = await teamRes.json();
        setMembers(data.members || []);
        setCurrentUserRole(data.currentUserRole);
      }

      // Fetch invitations (admin only)
      if (project.userRole === 'admin') {
        const invitesRes = await fetch(`/api/projects/${project.id}/invitations`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (invitesRes.ok) {
          const data = await invitesRes.json();
          setInvitations(data.invitations || []);
        }
      }
    } catch (err) {
      console.error('Failed to fetch team data:', err);
      setError('Failed to load team data');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !session?.access_token) return;

    setInviting(true);
    setError('');

    try {
      const res = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      if (res.ok) {
        setInviteEmail('');
        setInviteRole('viewer');
        setShowInviteForm(false);
        fetchProjectAndData(); // Refresh data
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send invitation');
      }
    } catch (err) {
      setError('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(memberId: string, newRole: string) {
    if (!projectId || !session?.access_token) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/team/${memberId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        fetchProjectAndData();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update role');
      }
    } catch (err) {
      setError('Failed to update role');
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!projectId || !session?.access_token) return;
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/team/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        fetchProjectAndData();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to remove member');
      }
    } catch (err) {
      setError('Failed to remove member');
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!projectId || !session?.access_token) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        fetchProjectAndData();
      }
    } catch (err) {
      setError('Failed to cancel invitation');
    }
  }

  if (!user) return null;

  const isAdmin = currentUserRole === 'admin';

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-b from-obsidian to-charcoal pt-24 px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold font-cinzel mb-2">Team Management</h1>
            <p className="text-gray-400">
              Manage team members for <span className="text-violet-spectral">{projectSlug}</span>
            </p>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="glass-panel p-8 text-center">
              <p className="text-gray-400">Loading team data...</p>
            </div>
          ) : (
            <>
              {/* Invite Button (Admin Only) */}
              {isAdmin && (
                <div className="mb-6">
                  <Button onClick={() => setShowInviteForm(!showInviteForm)}>
                    {showInviteForm ? 'Cancel' : '+ Invite Member'}
                  </Button>
                </div>
              )}

              {/* Invite Form */}
              {showInviteForm && isAdmin && (
                <div className="glass-panel p-6 mb-6">
                  <h2 className="text-xl font-bold mb-4">Invite New Member</h2>
                  <form onSubmit={handleInvite} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Email Address</label>
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
                        placeholder="colleague@example.com"
                        required
                        disabled={inviting}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Role</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as any)}
                        className="w-full px-4 py-2 bg-charcoal border border-graphite rounded-lg focus:outline-none focus:border-violet-spectral transition-colors"
                        disabled={inviting}
                      >
                        <option value="viewer">Viewer - Read-only access</option>
                        <option value="editor">Editor - Can propose updates</option>
                        <option value="admin">Admin - Full access</option>
                      </select>
                    </div>
                    <Button type="submit" disabled={inviting || !inviteEmail}>
                      {inviting ? 'Sending...' : 'Send Invitation'}
                    </Button>
                  </form>
                </div>
              )}

              {/* Pending Invitations (Admin Only) */}
              {isAdmin && invitations.length > 0 && (
                <div className="glass-panel p-6 mb-6">
                  <h2 className="text-xl font-bold mb-4">Pending Invitations</h2>
                  <div className="space-y-3">
                    {invitations.map((invite) => (
                      <div
                        key={invite.id}
                        className="bg-charcoal/50 rounded-lg p-4 border border-graphite flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{invite.email}</p>
                          <p className="text-sm text-gray-400">
                            Role: <span className="text-violet-ghost">{invite.role}</span>
                            {' · '}
                            Expires: {new Date(invite.expires_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancelInvitation(invite.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Members List */}
              <div className="glass-panel p-6">
                <h2 className="text-xl font-bold mb-4">Team Members ({members.length})</h2>
                <div className="space-y-3">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="bg-charcoal/50 rounded-lg p-4 border border-graphite hover:border-violet-spectral/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-full bg-violet-spectral/20 flex items-center justify-center">
                            <span className="text-violet-spectral font-bold">
                              {member.profiles.username?.charAt(0).toUpperCase() || '?'}
                            </span>
                          </div>
                          <div>
                            <p className="font-bold">{member.profiles.username}</p>
                            <p className="text-sm text-gray-400">{member.profiles.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Role Badge/Selector */}
                          {isAdmin && member.profiles.id !== user?.id ? (
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                              className="px-3 py-1 bg-charcoal border border-graphite rounded-lg text-sm focus:outline-none focus:border-violet-spectral"
                            >
                              <option value="viewer">Viewer</option>
                              <option value="editor">Editor</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                member.role === 'admin'
                                  ? 'bg-violet-spectral/20 text-violet-spectral'
                                  : member.role === 'editor'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-gray-500/20 text-gray-400'
                              }`}
                            >
                              {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                            </span>
                          )}

                          {/* Remove Button */}
                          {isAdmin && member.profiles.id !== user?.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-red-400 hover:text-red-300"
                            >
                              Remove
                            </Button>
                          )}

                          {/* Leave Button (for self) */}
                          {member.profiles.id === user?.id && members.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMember(member.id)}
                              className="text-gray-400 hover:text-gray-300"
                            >
                              Leave
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
