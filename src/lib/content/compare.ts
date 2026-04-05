// src/lib/content/compare.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ComparisonPage } from './types';

const COMPARE_DIR = path.join(process.cwd(), 'content/compare');

function parseComparison(data: Record<string, unknown>, slug: string, content: string): ComparisonPage {
  return {
    title: String(data.title || 'Untitled'),
    description: String(data.description || ''),
    slug,
    competitor: String(data.competitor || slug),
    competitorUrl: data.competitorUrl ? String(data.competitorUrl) : undefined,
    date: String(data.date || new Date().toISOString().split('T')[0]),
    features: Array.isArray(data.features) ? data.features : [],
    pricing: (data.pricing as ComparisonPage['pricing']) || { quoth: 'Free / $29/mo', competitor: 'Unknown' },
    verdict: String(data.verdict || ''),
    content,
    draft: Boolean(data.draft),
  };
}

export async function getAllComparisons(): Promise<ComparisonPage[]> {
  if (!fs.existsSync(COMPARE_DIR)) return [];

  const files = fs.readdirSync(COMPARE_DIR).filter(f => f.endsWith('.mdx'));

  return files
    .map(filename => {
      const filePath = path.join(COMPARE_DIR, filename);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(fileContent);
      return parseComparison(data, filename.replace('.mdx', ''), content);
    })
    .filter(p => !p.draft)
    .sort((a, b) => a.competitor.localeCompare(b.competitor));
}

export async function getComparisonBySlug(slug: string): Promise<ComparisonPage | null> {
  const filePath = path.join(COMPARE_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);
  return parseComparison(data, slug, content);
}
