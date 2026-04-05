// src/lib/content/glossary.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { GlossaryTerm } from './types';

const GLOSSARY_DIR = path.join(process.cwd(), 'content/glossary');

function parseTerm(data: Record<string, unknown>, slug: string, content: string): GlossaryTerm {
  return {
    term: String(data.term || slug),
    definition: String(data.definition || ''),
    slug,
    category: String(data.category || 'general'),
    relatedTerms: Array.isArray(data.relatedTerms) ? data.relatedTerms.map(String) : [],
    content,
    draft: Boolean(data.draft),
  };
}

export async function getAllTerms(): Promise<GlossaryTerm[]> {
  if (!fs.existsSync(GLOSSARY_DIR)) return [];

  const files = fs.readdirSync(GLOSSARY_DIR).filter(f => f.endsWith('.mdx'));

  return files
    .map(filename => {
      const filePath = path.join(GLOSSARY_DIR, filename);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(fileContent);
      return parseTerm(data, filename.replace('.mdx', ''), content);
    })
    .filter(t => !t.draft)
    .sort((a, b) => a.term.localeCompare(b.term));
}

export async function getTermBySlug(slug: string): Promise<GlossaryTerm | null> {
  const filePath = path.join(GLOSSARY_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);
  return parseTerm(data, slug, content);
}

export async function getTermsByCategory(category: string): Promise<GlossaryTerm[]> {
  const terms = await getAllTerms();
  return terms.filter(t => t.category === category);
}
