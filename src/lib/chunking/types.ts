/**
 * Shared types for the chunking module (QUOTH-10)
 *
 * Defines the public API surface for all chunking strategies:
 * AST-based (tree-sitter), text-based (paragraph splitting), and
 * the unified chunkDocument entry point.
 */

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/** Languages the AST chunker can handle via tree-sitter grammars. */
export type ASTLanguage = 'typescript' | 'javascript' | 'python';

/** All languages the chunking module recognises. */
export type SupportedLanguage =
  | ASTLanguage
  | 'markdown'
  | 'text';

/** Map of file extension (with dot) to SupportedLanguage. */
export const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.md': 'markdown',
  '.mdx': 'markdown',
};

// ---------------------------------------------------------------------------
// Chunk result
// ---------------------------------------------------------------------------

/** Method used to produce a chunk. */
export type ChunkMethod = 'ast' | 'text';

/** A single chunk produced by any chunking strategy. */
export interface ChunkResult {
  /** The chunk text (may include a context prefix). */
  content: string;
  /** AST node type (e.g. "function_declaration") or structural label. */
  type: string;
  /** 1-based start line in the source file. */
  startLine: number;
  /** 1-based end line in the source file. */
  endLine: number;
  /** How this chunk was produced. */
  method: ChunkMethod;
  /** Additional metadata. */
  metadata: {
    language: SupportedLanguage;
    filePath: string;
    parentContext?: string;
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options accepted by the unified `chunkDocument` entry point. */
export interface ChunkOptions {
  /**
   * Approximate max tokens per text chunk.
   * Default: 400 (~300 words).
   */
  maxChunkTokens?: number;
  /**
   * Number of overlapping sentences between consecutive text chunks.
   * Default: 1.
   */
  overlapSentences?: number;
  /**
   * Skip AST entirely — always use the text chunker.
   * Default: false.
   */
  skipAst?: boolean;
  /**
   * Force text fallback even for AST-capable languages.
   * Alias kept for caller convenience; same effect as skipAst.
   * Default: false.
   */
  forceTextFallback?: boolean;
  /**
   * Optional document title injected as a context prefix in text chunks.
   */
  documentTitle?: string;
  /**
   * Optional document type label injected as a context prefix.
   */
  documentType?: string;
}

// ---------------------------------------------------------------------------
// Lazy-loader callback
// ---------------------------------------------------------------------------

/** Progress events emitted by the lazy WASM loader. */
export type LoaderProgressEvent =
  | { stage: 'core-init'; language?: undefined }
  | { stage: 'language-load'; language: ASTLanguage };

/** Callback callers can pass to monitor WASM loading progress. */
export type LoaderProgressCallback = (event: LoaderProgressEvent) => void;

// ---------------------------------------------------------------------------
// Size-guard thresholds (exported so tests can override)
// ---------------------------------------------------------------------------

export const SIZE_GUARD_DEFAULTS = {
  /** Files larger than this (bytes) skip AST chunking. */
  maxFileSizeBytes: 500 * 1024, // 500 KB
  /** Files with more lines than this skip AST chunking. */
  maxFileLines: 10_000,
  /** Warn when WASM heap exceeds this (bytes). */
  wasmMemoryWarnBytes: 256 * 1024 * 1024, // 256 MB
} as const;
