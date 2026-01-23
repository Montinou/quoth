// src/lib/content/changelog.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { ChangelogEntry } from './types';

const CHANGELOG_DIR = path.join(process.cwd(), 'content/changelog');

/**
 * Parse a single changelog file that uses H3 headings for dates.
 * Format: ### YYYY-MM-DD followed by content until next H3/H2 or end of file.
 */
function parseChangelogFile(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  // Match date headings like ### 2026-01-23
  const dateRegex = /^###\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
  const matches = [...content.matchAll(dateRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const date = match[1];
    const startIndex = match.index! + match[0].length;

    // Find end of this entry (next date heading or H2 or end)
    const nextMatch = matches[i + 1];
    const nextH2 = content.indexOf('\n## ', startIndex);
    let endIndex = content.length;

    if (nextMatch && nextMatch.index !== undefined) {
      endIndex = Math.min(endIndex, nextMatch.index);
    }
    if (nextH2 !== -1 && nextH2 < endIndex) {
      endIndex = nextH2;
    }

    const entryContent = content.slice(startIndex, endIndex).trim();

    // Extract title from first bold text or first line
    const titleMatch = entryContent.match(/^\*\*([^*]+)\*\*/);
    const title = titleMatch ? titleMatch[1] : undefined;

    // Extract version if present (format: v1.0.0 or Genesis v2.0)
    const versionMatch = entryContent.match(/v(\d+\.?\d*\.?\d*)/i);
    const version = versionMatch ? versionMatch[1] : undefined;

    entries.push({
      date,
      title,
      version,
      content: entryContent,
    });
  }

  return entries;
}

export async function getAllChangelogs(): Promise<ChangelogEntry[]> {
  if (!fs.existsSync(CHANGELOG_DIR)) return [];

  const files = fs.readdirSync(CHANGELOG_DIR).filter(f => f.endsWith('.mdx'));
  let allEntries: ChangelogEntry[] = [];

  for (const filename of files) {
    const filePath = path.join(CHANGELOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContent);

    // Check if this file has date headings (single-file format)
    if (content.includes('### 20')) {
      const parsedEntries = parseChangelogFile(content);
      allEntries = [...allEntries, ...parsedEntries];
    } else if (data.date) {
      // Individual file format with frontmatter date
      allEntries.push({
        date: data.date,
        version: data.version,
        title: data.title,
        content,
      });
    }
  }

  return allEntries.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function groupChangelogsByMonth(entries: ChangelogEntry[]): Record<string, ChangelogEntry[]> {
  const grouped: Record<string, ChangelogEntry[]> = {};

  entries.forEach(entry => {
    const date = new Date(entry.date);
    const monthKey = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });

    if (!grouped[monthKey]) grouped[monthKey] = [];
    grouped[monthKey].push(entry);
  });

  return grouped;
}

export function formatChangelogDate(dateStr: string): { month: string; day: string; year: string } {
  const date = new Date(dateStr);
  return {
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    day: date.getDate().toString(),
    year: date.getFullYear().toString(),
  };
}
