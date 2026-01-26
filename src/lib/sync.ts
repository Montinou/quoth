import { createHash } from "crypto";
import matter from "gray-matter";
import { supabase, type Document } from "./supabase";
import { generateEmbedding } from "./ai";

import { astChunker, type CodeChunk } from "./quoth/chunking";

/**
 * Valid document types for coverage calculation
 * Maps to Genesis phases and Quoth documentation categories
 */
export type DocType = 'testing-pattern' | 'architecture' | 'contract' | 'meta' | 'template';

/**
 * Extract document type from content frontmatter or file path
 * Priority: frontmatter type > path-based inference
 */
export function extractDocType(filePath: string, content: string): DocType | null {
  // 1. Try to extract from YAML frontmatter
  try {
    const { data } = matter(content);
    if (data.type && isValidDocType(data.type)) {
      return data.type as DocType;
    }
  } catch {
    // Frontmatter parsing failed, fall back to path inference
  }

  // 2. Infer from file path patterns
  const lowerPath = filePath.toLowerCase();

  // Architecture documents (Genesis Phase 1-2)
  if (
    lowerPath.includes('project-overview') ||
    lowerPath.includes('tech-stack') ||
    lowerPath.includes('repo-structure') ||
    lowerPath.includes('/architecture/') ||
    lowerPath.startsWith('architecture/')
  ) {
    return 'architecture';
  }

  // Testing patterns (Genesis Phase 3)
  if (
    lowerPath.includes('testing-pattern') ||
    lowerPath.includes('coding-conventions') ||
    lowerPath.includes('/patterns/') ||
    lowerPath.startsWith('patterns/')
  ) {
    return 'testing-pattern';
  }

  // Contracts (Genesis Phase 4)
  if (
    lowerPath.includes('api-schemas') ||
    lowerPath.includes('database-models') ||
    lowerPath.includes('shared-types') ||
    lowerPath.includes('/contracts/') ||
    lowerPath.startsWith('contracts/')
  ) {
    return 'contract';
  }

  // Meta documents
  if (
    lowerPath.includes('/meta/') ||
    lowerPath.startsWith('meta/') ||
    lowerPath.includes('validation-log')
  ) {
    return 'meta';
  }

  // Templates
  if (lowerPath.includes('/templates/') || lowerPath.startsWith('templates/')) {
    return 'template';
  }

  return null;
}

function isValidDocType(type: string): boolean {
  return ['testing-pattern', 'architecture', 'contract', 'meta', 'template'].includes(type);
}

/**
 * Calculate MD5 checksum for content
 */
export function calculateChecksum(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

/**
 * Chunk content using AST for code or headers for markdown
 */
export async function chunkContent(filePath: string, content: string): Promise<CodeChunk[]> {
  return astChunker.chunkFile(filePath, content);
}

/**
 * Sync document with INCREMENTAL re-indexing
 * Only re-embed chunks whose content has changed
 */
export async function syncDocument(
  projectId: string,
  filePath: string,
  title: string,
  content: string
): Promise<{ 
  document: Document & { version?: number }; 
  chunksIndexed: number; 
  chunksReused: number 
}> {
  const checksum = calculateChecksum(content);

  // 1. Check if document unchanged
  const { data: existing } = await supabase
    .from("documents")
    .select("id, checksum, version")
    .eq("project_id", projectId)
    .eq("file_path", filePath)
    .single();

  if (existing && existing.checksum === checksum) {
    return {
      document: existing as Document & { version?: number },
      chunksIndexed: 0,
      chunksReused: 0,
    };
  }

  // 2. Extract document type from frontmatter or path
  const docType = extractDocType(filePath, content);

  // 3. Upsert document (trigger handles versioning)
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .upsert({
      project_id: projectId,
      file_path: filePath,
      title,
      content,
      checksum,
      doc_type: docType,
      last_updated: new Date().toISOString(),
    }, { onConflict: "project_id, file_path" })
    .select()
    .single();

  if (docError) throw new Error(`Failed to upsert: ${docError.message}`);

  // 4. Chunk content
  const chunks = await chunkContent(filePath, content);

  // 5. Calculate hashes
  const chunkData = chunks.map((chunk, index) => ({
    content: chunk.content,
    hash: calculateChecksum(chunk.content),
    index,
    metadata: chunk.metadata
  }));

  // 6. Get existing embeddings
  const { data: existingEmbeddings } = await supabase
    .from("document_embeddings")
    .select("id, chunk_hash")
    .eq("document_id", doc.id);

  const existingHashes = new Set((existingEmbeddings || []).map(e => e.chunk_hash));
  const newHashes = new Set(chunkData.map(c => c.hash));

  // 7. Find chunks to embed (changed/new)
  const chunksToEmbed = chunkData.filter(c => !existingHashes.has(c.hash));

  // 8. Find orphaned embeddings (removed sections)
  const orphanedIds = (existingEmbeddings || [])
    .filter(e => !newHashes.has(e.chunk_hash))
    .map(e => e.id);

  // 9. Delete orphaned
  if (orphanedIds.length > 0) {
    await supabase.from("document_embeddings").delete().in("id", orphanedIds);
  }

  // 10. Generate embeddings for new/changed only
  let indexedCount = 0;
  for (const chunk of chunksToEmbed) {
    try {
      const embedding = await generateEmbedding(chunk.content);
      await supabase.from("document_embeddings").insert({
        document_id: doc.id,
        content_chunk: chunk.content,
        chunk_hash: chunk.hash,
        embedding,
        metadata: { 
          chunk_index: chunk.index, 
          source: "incremental-sync",
          ...chunk.metadata
        },
      });
      indexedCount++;
      if (indexedCount < chunksToEmbed.length) {
        await new Promise(r => setTimeout(r, 4200)); // Rate limit
      }
    } catch (error) {
      console.error(`Failed chunk ${chunk.index}:`, error);
    }
  }

  return {
    document: doc as Document & { version?: number },
    chunksIndexed: indexedCount,
    chunksReused: chunks.length - chunksToEmbed.length,
  };
}

/**
 * Delete a document and its embeddings
 */
export async function deleteDocument(
  projectId: string,
  filePath: string
): Promise<boolean> {
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("project_id", projectId)
    .eq("file_path", filePath);

  return !error;
}

/**
 * Get sync status for a project
 */
export async function getSyncStatus(projectId: string): Promise<{
  documentCount: number;
  embeddingCount: number;
  lastSync: string | null;
}> {
  const { count: docCount } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: docs } = await supabase
    .from("documents")
    .select("id")
    .eq("project_id", projectId);

  let embeddingCount = 0;
  let lastSync: string | null = null;

  if (docs && docs.length > 0) {
    const docIds = docs.map((d) => d.id);

    const { count } = await supabase
      .from("document_embeddings")
      .select("*", { count: "exact", head: true })
      .in("document_id", docIds);

    embeddingCount = count || 0;

    // Get most recent update
    const { data: latest } = await supabase
      .from("documents")
      .select("last_updated")
      .eq("project_id", projectId)
      .order("last_updated", { ascending: false })
      .limit(1)
      .single();

    lastSync = latest?.last_updated || null;
  }

  return {
    documentCount: docCount || 0,
    embeddingCount,
    lastSync,
  };
}
