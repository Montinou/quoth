import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guide',
  description: 'Getting started with Quoth MCP server. Installation guide for Claude Code, Claude Desktop, and other MCP clients. OAuth setup and API key generation.',
  openGraph: {
    title: 'Quoth Guide | Getting Started',
    description: 'Step-by-step guide to integrate Quoth with Claude Code, Claude Desktop, and MCP clients. OAuth authentication and API key setup.',
  },
  alternates: { canonical: 'https://quoth.triqual.dev/guide' },
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
