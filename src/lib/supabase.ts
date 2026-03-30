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
  /** Async indexing lifecycle: pending → indexing → indexed | failed */
  indexing_status?: 'pending' | 'indexing' | 'indexed' | 'failed' | null;
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

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Lazy-initialized server-side Supabase client using Service Role key.
 * Only creates the client when env vars are present; throws at call-site
 * (not at module-load) if Supabase is not configured.
 */
let _supabaseClient: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = new Proxy({} as any, {
  get(_target, prop) {
    if (!_supabaseClient) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          `[Supabase] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. ` +
          `Supabase service client cannot be used without configuration.`
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('@supabase/supabase-js');
      _supabaseClient = createClient(url, key);
    }
    return (_supabaseClient as any)[prop as string];
  },
});

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
