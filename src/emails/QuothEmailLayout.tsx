/**
 * Quoth Email Layout
 * Shared base layout for all Quoth authentication emails
 * Design: "Intellectual Neo-Noir" - Dark theme with violet accents
 */

import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

// Quoth Design System Colors
const colors = {
  obsidian: '#050505',
  charcoal: '#121212',
  graphite: '#262626',
  violetSpectral: '#8B5CF6',
  violetGlow: '#7C3AED',
  violetGhost: '#DDD6FE',
  text: '#e5e5e5',
  textMuted: '#a3a3a3',
};

interface QuothEmailLayoutProps {
  preview: string;
  children: React.ReactNode;
}

export function QuothEmailLayout({ preview, children }: QuothEmailLayoutProps) {
  return (
    <Html>
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap');
          `}
        </style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logo}>QUOTH</Text>
            <Text style={tagline}>Single Source of Truth</Text>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            {children}
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Quoth - AI-Powered Knowledge Base Auditor
            </Text>
            <Text style={footerLinks}>
              <Link href="https://quoth.ai-innovation.site" style={footerLink}>
                Website
              </Link>
              {' | '}
              <Link href="https://quoth.ai-innovation.site/guide" style={footerLink}>
                Documentation
              </Link>
              {' | '}
              <Link href="mailto:support@ai-innovation.site" style={footerLink}>
                Support
              </Link>
            </Text>
            <Text style={footerCopyright}>
              &copy; {new Date().getFullYear()} Quoth. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Shared Button Component
export function QuothButton({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <table
      width="100%"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ marginTop: '24px', marginBottom: '24px' }}
    >
      <tr>
        <td align="center">
          <Link href={href} style={button}>
            {children}
          </Link>
        </td>
      </tr>
    </table>
  );
}

// Styles
const main: React.CSSProperties = {
  backgroundColor: colors.obsidian,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container: React.CSSProperties = {
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '560px',
};

const header: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: '32px',
};

const logo: React.CSSProperties = {
  fontFamily: 'Cinzel, Georgia, serif',
  fontSize: '32px',
  fontWeight: 700,
  color: colors.violetSpectral,
  margin: '0',
  letterSpacing: '4px',
};

const tagline: React.CSSProperties = {
  fontSize: '12px',
  color: colors.violetGhost,
  margin: '8px 0 0 0',
  letterSpacing: '2px',
  textTransform: 'uppercase',
};

const content: React.CSSProperties = {
  backgroundColor: colors.charcoal,
  borderRadius: '12px',
  padding: '32px',
  border: `1px solid ${colors.graphite}`,
};

const footer: React.CSSProperties = {
  textAlign: 'center',
  marginTop: '32px',
};

const footerText: React.CSSProperties = {
  fontSize: '14px',
  color: colors.textMuted,
  margin: '0 0 12px 0',
};

const footerLinks: React.CSSProperties = {
  fontSize: '12px',
  color: colors.textMuted,
  margin: '0 0 12px 0',
};

const footerLink: React.CSSProperties = {
  color: colors.violetGhost,
  textDecoration: 'none',
};

const footerCopyright: React.CSSProperties = {
  fontSize: '11px',
  color: colors.textMuted,
  margin: '0',
};

const button: React.CSSProperties = {
  backgroundColor: colors.violetSpectral,
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 600,
  textDecoration: 'none',
  textAlign: 'center',
  display: 'inline-block',
  padding: '14px 32px',
};

// Export styles for use in child templates
export const emailStyles = {
  colors,
  heading: {
    fontSize: '24px',
    fontWeight: 600,
    color: colors.text,
    margin: '0 0 16px 0',
    textAlign: 'center' as const,
  },
  paragraph: {
    fontSize: '16px',
    lineHeight: '24px',
    color: colors.text,
    margin: '0 0 16px 0',
  },
  highlight: {
    color: colors.violetGhost,
    fontWeight: 500,
  },
  codeBlock: {
    backgroundColor: colors.graphite,
    borderRadius: '6px',
    padding: '12px 16px',
    fontFamily: 'monospace',
    fontSize: '14px',
    color: colors.violetGhost,
    margin: '16px 0',
  },
  divider: {
    borderTop: `1px solid ${colors.graphite}`,
    margin: '24px 0',
  },
  smallText: {
    fontSize: '13px',
    color: colors.textMuted,
    margin: '0',
  },
};

export default QuothEmailLayout;
