import { createClient } from "@supabase/supabase-js";

// Database types for Quoth vector storage
export interface Project {
  id: string;
  slug: string;
  github_repo?: string; // Deprecated
  created_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  file_path: string;
  title: string;
  content: string;
  checksum: string;
  last_updated: string;
  doc_type: 'testing-pattern' | 'architecture' | 'contract' | 'meta' | 'template' | null;
}

export interface DocumentEmbedding {
  id: string;
  document_id: string;
  content_chunk: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface MatchResult {
  id: string;
  document_id: string;
  content_chunk: string;
  similarity: number;
  file_path: string;
  title: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result from get_chunks_by_ids RPC
 */
export interface ChunkByIdResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_path: string;
  content_chunk: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
  total_chunks: number;
}

// Server-side Supabase client using Service Role key
// Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Get or create a project by slug
export async function getOrCreateProject(
  slug: string
): Promise<Project> {
  // Try to find existing project
  const { data: existing } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .single();

  if (existing) {
    return existing as Project;
  }

  // Create new project
  const { data: created, error } = await supabase
    .from("projects")
    .insert({
      slug,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create project: ${error.message}`);
  }

  return created as Project;
}

// Get project by slug
export async function getProjectBySlug(
  slug: string
): Promise<Project | null> {
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .single();

  return data as Project | null;
}
