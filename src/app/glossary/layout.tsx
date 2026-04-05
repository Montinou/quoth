import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'AI & MCP Glossary',
    template: 'What is %s? | Quoth Glossary',
  },
  description: 'Glossary of AI, MCP, and knowledge management terms. Clear definitions for Model Context Protocol, RAG, vector embeddings, and more.',
  alternates: { canonical: 'https://quoth.triqual.dev/glossary' },
};

export default function GlossaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
