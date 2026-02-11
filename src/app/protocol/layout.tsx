import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Protocol',
  description: 'Quoth MCP Protocol documentation: quoth_search_index, quoth_read_doc, quoth_propose_update tools. AI Personas for code generation and auditing.',
  openGraph: {
    title: 'Quoth Protocol | MCP Tools & AI Personas',
    description: 'Complete reference for Quoth MCP tools and AI personas. Semantic search, document retrieval, and documentation proposals.',
  },
  alternates: { canonical: 'https://quoth.triqual.dev/protocol' },
};

export default function ProtocolLayout({ children }: { children: React.ReactNode }) {
  return children;
}
