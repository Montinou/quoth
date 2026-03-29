/**
 * Improved text fallback chunker (QUOTH-10)
 *
 * Used when AST chunking is unavailable or explicitly skipped.
 * Splits on paragraph boundaries (double newline), respects a max
 * token budget per chunk (~400 tokens ≈ 300 words), and adds
 * configurable sentence overlap between consecutive chunks.
 */

import type { ChunkResult, SupportedLanguage } from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_OVERLAP_SENTENCES = 1;
/** Rough token estimator: 1 word ≈ 1.3 tokens. */
const TOKENS_PER_WORD = 1.3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * TOKENS_PER_WORD);
}

/** Split text into sentences (good-enough heuristic). */
function splitSentences(text: string): string[] {
  // Split on . ? ! followed by whitespace or end-of-string, but keep the delimiter.
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build a context prefix from optional title/type. */
function buildPrefix(title?: string, docType?: string): string {
  const parts: string[] = [];
  if (title) parts.push(title);
  if (docType) parts.push(docType);
  return parts.length > 0 ? `[${parts.join(' | ')}] ` : '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TextChunkerOptions {
  maxChunkTokens?: number;
  overlapSentences?: number;
  documentTitle?: string;
  documentType?: string;
}

/**
 * Chunk arbitrary text content using paragraph splitting with overlap.
 *
 * @param content  - raw file/document content
 * @param filePath - source file path (for metadata)
 * @param language - detected language
 * @param opts     - chunking options
 */
export function chunkText(
  content: string,
  filePath: string,
  language: SupportedLanguage,
  opts?: TextChunkerOptions,
): ChunkResult[] {
  const maxTokens = opts?.maxChunkTokens ?? DEFAULT_MAX_TOKENS;
  const overlapCount = opts?.overlapSentences ?? DEFAULT_OVERLAP_SENTENCES;
  const prefix = buildPrefix(opts?.documentTitle, opts?.documentType);

  // Markdown: split on H2 headers first, then refine
  if (language === 'markdown') {
    return chunkMarkdown(content, filePath, prefix, maxTokens, overlapCount);
  }

  // Generic text / code without AST: split on paragraph boundaries
  return chunkParagraphs(content, filePath, language, prefix, maxTokens, overlapCount);
}

// ---------------------------------------------------------------------------
// Markdown chunking
// ---------------------------------------------------------------------------

function chunkMarkdown(
  content: string,
  filePath: string,
  prefix: string,
  maxTokens: number,
  overlapCount: number,
): ChunkResult[] {
  // Extract context from frontmatter for injection
  const fmPrefix = extractFrontmatterPrefix(content);
  const effectivePrefix = prefix || fmPrefix;

  const sections = content.split(/^## /gm);
  const rawChunks: { text: string; startLine: number }[] = [];
  let currentLine = 1;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) {
      currentLine += sections[i].split('\n').length;
      continue;
    }
    const text = i === 0 ? section : `## ${section}`;
    rawChunks.push({ text, startLine: currentLine });
    currentLine += sections[i].split('\n').length;
  }

  // Further split sections that exceed the token budget
  const results: ChunkResult[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const { text, startLine } = rawChunks[i];
    const subChunks = splitToTokenBudget(text, maxTokens);
    let lineOffset = startLine;

    for (const sub of subChunks) {
      const lineCount = sub.split('\n').length;
      const chunkContent = (i > 0 && effectivePrefix)
        ? `${effectivePrefix}\n${sub}`
        : sub;

      results.push({
        content: chunkContent,
        type: 'markdown_section',
        startLine: lineOffset,
        endLine: lineOffset + lineCount - 1,
        method: 'text',
        metadata: { language: 'markdown', filePath },
      });
      lineOffset += lineCount;
    }
  }

  // Add overlap sentences between chunks
  applyOverlap(results, overlapCount);

  // Guarantee at least one chunk
  if (results.length === 0) {
    results.push(wholeFileChunk(content, filePath, 'markdown'));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Paragraph-based chunking
// ---------------------------------------------------------------------------

function chunkParagraphs(
  content: string,
  filePath: string,
  language: SupportedLanguage,
  prefix: string,
  maxTokens: number,
  overlapCount: number,
): ChunkResult[] {
  const paragraphs = content.split(/\n\n+/);
  const results: ChunkResult[] = [];
  let currentLine = 1;

  let buffer = '';
  let bufferStartLine = currentLine;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      currentLine += para.split('\n').length + 1;
      continue;
    }

    const paraLines = para.split('\n').length;
    const merged = buffer ? `${buffer}\n\n${trimmed}` : trimmed;

    if (estimateTokens(merged) > maxTokens && buffer) {
      // Flush buffer as a chunk
      const chunkContent = prefix ? `${prefix}\n${buffer}` : buffer;
      results.push({
        content: chunkContent,
        type: 'text_block',
        startLine: bufferStartLine,
        endLine: currentLine - 1,
        method: 'text',
        metadata: { language, filePath },
      });
      buffer = trimmed;
      bufferStartLine = currentLine;
    } else {
      if (!buffer) bufferStartLine = currentLine;
      buffer = merged;
    }

    currentLine += paraLines + 1; // +1 for the blank line separator
  }

  // Flush remaining buffer
  if (buffer) {
    const chunkContent = prefix ? `${prefix}\n${buffer}` : buffer;
    results.push({
      content: chunkContent,
      type: 'text_block',
      startLine: bufferStartLine,
      endLine: currentLine - 1,
      method: 'text',
      metadata: { language, filePath },
    });
  }

  applyOverlap(results, overlapCount);

  if (results.length === 0) {
    results.push(wholeFileChunk(content, filePath, language));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Split a single text block into pieces that each fit within a token budget. */
function splitToTokenBudget(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];

  const sentences = splitSentences(text);
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (estimateTokens(candidate) > maxTokens && current) {
      pieces.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);

  return pieces.length > 0 ? pieces : [text];
}

/**
 * Add the last N sentences of chunk[i] to the beginning of chunk[i+1].
 * Mutates the array in place.
 */
function applyOverlap(chunks: ChunkResult[], sentences: number): void {
  if (sentences <= 0 || chunks.length < 2) return;

  for (let i = 1; i < chunks.length; i++) {
    const prevSentences = splitSentences(chunks[i - 1].content);
    const overlap = prevSentences.slice(-sentences).join(' ');
    if (overlap) {
      chunks[i] = {
        ...chunks[i],
        content: `${overlap}\n${chunks[i].content}`,
      };
    }
  }
}

/** Extract a context prefix from markdown frontmatter. */
function extractFrontmatterPrefix(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';

  const fm = fmMatch[1];
  const parts: string[] = [];

  const titleMatch = content.match(/^# (.+)$/m);
  if (titleMatch) parts.push(titleMatch[1]);

  const stackMatch = fm.match(/related_stack:\s*\[([^\]]*)\]/);
  if (stackMatch?.[1]?.trim()) parts.push(`Stack: ${stackMatch[1].trim()}`);

  const kwMatch = fm.match(/keywords:\s*\[([^\]]*)\]/);
  if (kwMatch?.[1]?.trim()) parts.push(kwMatch[1].trim());

  return parts.length > 0 ? `[${parts.join(' | ')}]` : '';
}

/** Produce a single whole-file chunk as a last resort. */
function wholeFileChunk(
  content: string,
  filePath: string,
  language: SupportedLanguage,
): ChunkResult {
  return {
    content,
    type: 'file',
    startLine: 1,
    endLine: content.split('\n').length,
    method: 'text',
    metadata: { language, filePath },
  };
}
