/**
 * Quoth Search Module
 * Handles document indexing and search functionality
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import {
  type DocumentReference,
  type QuothDocument,
  type SearchIndex,
  DocumentFrontmatterSchema,
  DEFAULT_CONFIG,
} from './types';

// Simple in-memory cache for development
let cachedIndex: SearchIndex | null = null;
let cacheTimestamp: number = 0;

/**
 * Get all markdown files from the knowledge base recursively
 */
async function getMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await getMarkdownFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch {
    console.error(`Error reading directory: ${dir}`);
  }
  
  return files;
}

/**
 * Parse a markdown file and extract frontmatter + content
 */
async function parseDocument(filePath: string): Promise<QuothDocument | null> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(fileContent);
    
    // Validate frontmatter
    const frontmatter = DocumentFrontmatterSchema.safeParse(data);
    
    if (!frontmatter.success) {
      console.warn(`Invalid frontmatter in ${filePath}:`, frontmatter.error);
      return null;
    }
    
    // Extract title from first H1 heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, '.md');
    
    return {
      id: frontmatter.data.id,
      title,
      type: frontmatter.data.type,
      path: filePath,
      frontmatter: frontmatter.data,
      content,
    };
  } catch (error) {
    console.error(`Error parsing document ${filePath}:`, error);
    return null;
  }
}

/**
 * Build the search index from all documents
 */
export async function buildSearchIndex(
  knowledgeBasePath: string = DEFAULT_CONFIG.knowledgeBasePath
): Promise<SearchIndex> {
  // Check cache validity (1 hour)
  const now = Date.now();
  if (cachedIndex && now - cacheTimestamp < DEFAULT_CONFIG.cacheRevalidateSeconds * 1000) {
    return cachedIndex;
  }
  
  const absolutePath = path.resolve(process.cwd(), knowledgeBasePath);
  const files = await getMarkdownFiles(absolutePath);
  const documents: DocumentReference[] = [];
  
  for (const file of files) {
    const doc = await parseDocument(file);
    if (doc) {
      documents.push({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        path: path.relative(absolutePath, file),
        relevance: 1.0,
      });
    }
  }
  
  cachedIndex = {
    documents,
    lastUpdated: new Date().toISOString(),
  };
  cacheTimestamp = now;
  
  return cachedIndex;
}

/**
 * Search documents by query string
 * Uses simple text matching - can be enhanced with vector embeddings later
 */
export async function searchDocuments(
  query: string,
  knowledgeBasePath: string = DEFAULT_CONFIG.knowledgeBasePath
): Promise<DocumentReference[]> {
  const index = await buildSearchIndex(knowledgeBasePath);
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);
  
  const results: DocumentReference[] = [];
  
  for (const doc of index.documents) {
    // Calculate relevance based on term matches
    let relevance = 0;
    const searchableText = `${doc.id} ${doc.title} ${doc.type}`.toLowerCase();
    
    for (const term of terms) {
      if (searchableText.includes(term)) {
        relevance += 1;
      }
      // Boost exact ID match
      if (doc.id.toLowerCase() === term) {
        relevance += 5;
      }
    }
    
    if (relevance > 0) {
      results.push({
        ...doc,
        relevance: relevance / terms.length,
      });
    }
  }
  
  // Sort by relevance (descending)
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Read a full document by its ID
 */
export async function readDocument(
  docId: string,
  knowledgeBasePath: string = DEFAULT_CONFIG.knowledgeBasePath
): Promise<QuothDocument | null> {
  const absolutePath = path.resolve(process.cwd(), knowledgeBasePath);
  const files = await getMarkdownFiles(absolutePath);
  
  for (const file of files) {
    const doc = await parseDocument(file);
    if (doc && doc.id === docId) {
      return doc;
    }
  }
  
  return null;
}

/**
 * Get all documents in the knowledge base
 */
export async function getAllDocuments(
  knowledgeBasePath: string = DEFAULT_CONFIG.knowledgeBasePath
): Promise<QuothDocument[]> {
  const absolutePath = path.resolve(process.cwd(), knowledgeBasePath);
  const files = await getMarkdownFiles(absolutePath);
  const documents: QuothDocument[] = [];
  
  for (const file of files) {
    const doc = await parseDocument(file);
    if (doc) {
      documents.push(doc);
    }
  }
  
  return documents;
}
