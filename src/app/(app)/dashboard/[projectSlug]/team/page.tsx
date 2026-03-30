/**
 * Team Management Page
 * Allows admins to invite users, manage members, and handle roles
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
  const { user } = useUser();
  const { getToken } = useAuth();
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
    const authToken = await getToken();
    if (!authToken) return;

    try {
      // First get project ID from slug
      const projectRes = await fetch(`/api/projects/by-slug/${projectSlug}`, {
        headers: { Authorization: `Bearer ${authToken}` },
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
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (teamRes.ok) {
        const data = await teamRes.json();
        setMembers(data.members || []);
        setCurrentUserRole(data.currentUserRole);
      }

      // Fetch invitations (admin only)
      if (project.userRole === 'admin') {
        const invitesRes = await fetch(`/api/projects/${project.id}/invitations`, {
          headers: { Authorization: `Bearer ${authToken}` },
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
    const authToken = await getToken();
    if (!projectId || !authToken) return;

    setInviting(true);
    setError('');

    try {
      const res = await fetch(`/api/projects/${projectId}/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
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
    const authToken = await getToken();
    if (!projectId || !authToken) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/team/${memberId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${authToken}`,
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
    const authToken = await getToken();
    if (!projectId || !authToken) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/team/${memberId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
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
    const authToken = await getToken();
    if (!projectId || !authToken) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
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
    <div className="px-6 py-8 md:pt-8">
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
                    <Select
                      value={inviteRole}
                      onValueChange={(val) => setInviteRole(val as 'admin' | 'editor' | 'viewer')}
                      disabled={inviting}
                    >
                      <SelectTrigger className="w-full bg-charcoal border-graphite focus:border-violet-spectral">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                        <SelectItem value="editor">Editor - Can propose updates</SelectItem>
                        <SelectItem value="admin">Admin - Full access</SelectItem>
                      </SelectContent>
                    </Select>
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
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            Cancel
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cancel the invitation sent to <strong>{invite.email}</strong>? They will no longer be able to join using this invite.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleCancelInvitation(invite.id)}>
                              Cancel Invitation
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
                        <Avatar>
                          <AvatarImage
                            src={member.profiles.avatar_url}
                            alt={member.profiles.username}
                          />
                          <AvatarFallback className="bg-violet-spectral/20 text-violet-spectral font-bold">
                            {member.profiles.username?.[0]?.toUpperCase() || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-bold">{member.profiles.username}</p>
                          <p className="text-sm text-gray-400">{member.profiles.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Role Badge/Selector */}
                        {isAdmin && member.profiles.id !== user?.id ? (
                          <Select
                            value={member.role}
                            onValueChange={(val) => handleUpdateRole(member.id, val)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">Viewer</SelectItem>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
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
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-400 hover:text-red-300"
                              >
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Member</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove <strong>{member.profiles.username}</strong> from this project? They will lose access immediately.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {/* Leave Button (for self) */}
                        {member.profiles.id === user?.id && members.length > 1 && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-gray-300"
                              >
                                Leave
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Leave Project</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Leave this project? You will lose access and will need to be re-invited to rejoin.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Leave
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
  );
}
