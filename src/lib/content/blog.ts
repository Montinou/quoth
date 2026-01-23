// src/lib/content/blog.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { BlogPost } from './types';

const BLOG_DIR = path.join(process.cwd(), 'content/blog');

function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200;
  const words = content.trim().split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
}

/**
 * Safely parse frontmatter data into a BlogPost with defaults for missing fields.
 * Prevents type assertion from masking missing required fields.
 */
function parseBlogPost(data: Record<string, unknown>, slug: string, content: string): BlogPost {
  return {
    title: String(data.title || 'Untitled'),
    description: String(data.description || ''),
    date: String(data.date || new Date().toISOString().split('T')[0]),
    author: String(data.author || 'Unknown'),
    slug,
    content,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    image: data.image ? String(data.image) : undefined,
    featured: Boolean(data.featured),
    draft: Boolean(data.draft),
    readingTime: typeof data.readingTime === 'number' ? data.readingTime : calculateReadingTime(content),
  };
}

export async function getAllPosts(): Promise<BlogPost[]> {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));

  const posts = files.map(filename => {
    const filePath = path.join(BLOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContent);
    const slug = filename.replace('.mdx', '');

    return parseBlogPost(data, slug, content);
  });

  return posts
    .filter(p => !p.draft)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);

  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);

  return parseBlogPost(data, slug, content);
}

export async function getFeaturedPost(): Promise<BlogPost | null> {
  const posts = await getAllPosts();
  return posts.find(p => p.featured) || posts[0] || null;
}

export async function getRelatedPosts(currentSlug: string, tags: string[] = [], limit = 3): Promise<BlogPost[]> {
  const posts = await getAllPosts();
  return posts
    .filter(p => p.slug !== currentSlug)
    .filter(p => p.tags?.some(t => tags.includes(t)))
    .slice(0, limit);
}
