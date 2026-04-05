// src/lib/content/integrations.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { IntegrationPage } from './types';

const INTEGRATIONS_DIR = path.join(process.cwd(), 'content/integrations');

function parseIntegration(data: Record<string, unknown>, slug: string, content: string): IntegrationPage {
  return {
    title: String(data.title || 'Untitled'),
    description: String(data.description || ''),
    slug,
    client: String(data.client || slug),
    clientUrl: data.clientUrl ? String(data.clientUrl) : undefined,
    icon: data.icon ? String(data.icon) : undefined,
    date: String(data.date || new Date().toISOString().split('T')[0]),
    supported: data.supported !== false,
    features: Array.isArray(data.features) ? data.features.map(String) : [],
    content,
    draft: Boolean(data.draft),
  };
}

export async function getAllIntegrations(): Promise<IntegrationPage[]> {
  if (!fs.existsSync(INTEGRATIONS_DIR)) return [];

  const files = fs.readdirSync(INTEGRATIONS_DIR).filter(f => f.endsWith('.mdx'));

  return files
    .map(filename => {
      const filePath = path.join(INTEGRATIONS_DIR, filename);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(fileContent);
      return parseIntegration(data, filename.replace('.mdx', ''), content);
    })
    .filter(p => !p.draft)
    .sort((a, b) => a.client.localeCompare(b.client));
}

export async function getIntegrationBySlug(slug: string): Promise<IntegrationPage | null> {
  const filePath = path.join(INTEGRATIONS_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);
  return parseIntegration(data, slug, content);
}
