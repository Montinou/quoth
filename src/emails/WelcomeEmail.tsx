/**
 * Welcome Email Template
 * Sent when a new user signs up and needs to verify their email
 */

import { Hr, Text } from '@react-email/components';
import * as React from 'react';
import { QuothEmailLayout, QuothButton, emailStyles } from './QuothEmailLayout';

interface WelcomeEmailProps {
  username?: string;
  confirmationUrl: string;
}

export function WelcomeEmail({ username, confirmationUrl }: WelcomeEmailProps) {
  const displayName = username || 'there';

  return (
    <QuothEmailLayout preview="Welcome to Quoth - Verify your email to get started">
      <Text style={emailStyles.heading}>
        Welcome to Quoth
      </Text>

      <Text style={emailStyles.paragraph}>
        Hi <span style={emailStyles.highlight}>{displayName}</span>,
      </Text>

      <Text style={emailStyles.paragraph}>
        Thanks for signing up! You're one step away from accessing your own
        knowledge base - the single source of truth for your codebase documentation.
      </Text>

      <Text style={emailStyles.paragraph}>
        Click the button below to verify your email address and activate your account:
      </Text>

      <QuothButton href={confirmationUrl}>
        Verify Email
      </QuothButton>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.paragraph}>
        <strong>What you can do with Quoth:</strong>
      </Text>

      <Text style={emailStyles.paragraph}>
        <span style={emailStyles.highlight}>Search</span> - Semantic search across your documentation
        <br />
        <span style={emailStyles.highlight}>Read</span> - Access your knowledge base from any AI agent
        <br />
        <span style={emailStyles.highlight}>Propose</span> - AI agents can suggest documentation updates
      </Text>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.smallText}>
        If you didn't create an account, you can safely ignore this email.
        This link will expire in 24 hours.
      </Text>
    </QuothEmailLayout>
  );
}

export default WelcomeEmail;
