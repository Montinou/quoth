/**
 * Team Invitation Email Template
 * Sent when a user is invited to join a project
 */

import { Hr, Text } from '@react-email/components';
import * as React from 'react';
import { QuothEmailLayout, QuothButton, emailStyles } from './QuothEmailLayout';

interface TeamInvitationEmailProps {
  projectName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

const rolePermissions: Record<string, string[]> = {
  admin: [
    'Full project management',
    'Invite and manage team members',
    'Approve documentation proposals',
    'Generate API keys',
  ],
  editor: [
    'Search and read documentation',
    'Propose documentation updates',
    'Generate API keys for MCP access',
  ],
  viewer: [
    'Search and read documentation',
    'View project proposals',
  ],
};

export function TeamInvitationEmail({
  projectName,
  inviterName,
  role,
  acceptUrl,
}: TeamInvitationEmailProps) {
  const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);
  const permissions = rolePermissions[role] || rolePermissions.viewer;

  return (
    <QuothEmailLayout preview={`${inviterName} invited you to join ${projectName}`}>
      <Text style={emailStyles.heading}>
        You're Invited!
      </Text>

      <Text style={emailStyles.paragraph}>
        <span style={emailStyles.highlight}>{inviterName}</span> has invited you to join
        the project <span style={emailStyles.highlight}>{projectName}</span> on Quoth.
      </Text>

      <Text style={emailStyles.paragraph}>
        You've been invited as a <span style={emailStyles.highlight}>{roleDisplay}</span>,
        which means you can:
      </Text>

      <Text style={emailStyles.paragraph}>
        {permissions.map((permission, index) => (
          <React.Fragment key={index}>
            - {permission}
            {index < permissions.length - 1 && <br />}
          </React.Fragment>
        ))}
      </Text>

      <QuothButton href={acceptUrl}>
        Accept Invitation
      </QuothButton>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.smallText}>
        This invitation expires in 7 days. If you don't have a Quoth account,
        you'll be prompted to create one when you click the button above.
      </Text>
    </QuothEmailLayout>
  );
}

export default TeamInvitationEmail;
