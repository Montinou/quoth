import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Integrations',
    template: '%s | Quoth Integrations',
  },
  description: 'Connect Quoth with your favorite MCP clients. Setup guides for Claude Code, Claude Desktop, Cursor, Windsurf, and more.',
  alternates: { canonical: 'https://quoth.triqual.dev/integrations' },
};

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
