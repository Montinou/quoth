/**
 * Unified chunking entry point (QUOTH-10)
 *
 * `chunkDocument(content, filePath, options?)` auto-detects the language,
 * applies size guards, uses AST chunking when available, and falls back
 * to the improved text chunker otherwise.
 *
 * This module is the public API — callers should import from here.
 */

import path from 'path';
import {
  EXTENSION_MAP,
  type ASTLanguage,
  type ChunkMethod,
  type ChunkOptions,
  type ChunkResult,
  type SupportedLanguage,
} from './types';
import { wasmLoader } from './lazy-loader';
import { checkSizeGuard } from './size-guard';
import { chunkText } from './text-chunker';

// Re-export public types so callers only need one import path
export type {
  ChunkResult,
  ChunkOptions,
  ChunkMethod,
  SupportedLanguage,
  ASTLanguage,
} from './types';
export type { LoaderProgressCallback } from './types';
export { wasmLoader } from './lazy-loader';

// ---------------------------------------------------------------------------
// Extractable AST node types per language
// ---------------------------------------------------------------------------

const EXTRACTABLE_TYPES: Record<string, string[]> = {
  typescript: [
    'function_declaration',
    'class_declaration',
    'method_definition',
    'arrow_function',
    'lexical_declaration',
    'export_statement',
    'interface_declaration',
    'type_alias_declaration',
  ],
  javascript: [
    'function_declaration',
    'class_declaration',
    'method_definition',
    'arrow_function',
    'lexical_declaration',
    'export_statement',
  ],
  python: [
    'function_definition',
    'class_definition',
    'decorated_definition',
  ],
};

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? 'text';
}

function isASTLanguage(lang: SupportedLanguage): lang is ASTLanguage {
  return lang === 'typescript' || lang === 'javascript' || lang === 'python';
}

// ---------------------------------------------------------------------------
// AST chunk extraction (mirrors original ASTChunker logic)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractChunksFromTree(
  tree: any,
  sourceCode: string,
  lang: SupportedLanguage,
  filePath: string,
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const extractableTypes = EXTRACTABLE_TYPES[lang] ?? [];

  if (extractableTypes.length === 0) {
    return [{
      content: sourceCode,
      type: 'file',
      startLine: 1,
      endLine: sourceCode.split('\n').length,
      method: 'ast',
      metadata: { language: lang, filePath },
    }];
  }

  const cursor = tree.walk();
  const visited = new Set<number>();

  const traverse = () => {
    const node = cursor.currentNode;
    if (visited.has(node.id)) return;

    if (extractableTypes.includes(node.type)) {
      visited.add(node.id);

      let content = sourceCode.slice(node.startIndex, node.endIndex);
      let startLine = node.startPosition.row + 1;

      // Include preceding comment
      const prevSibling = node.previousSibling;
      if (prevSibling && prevSibling.type === 'comment') {
        content =
          sourceCode.slice(prevSibling.startIndex, prevSibling.endIndex) +
          '\n' +
          content;
        startLine = prevSibling.startPosition.row + 1;
      }

      // Parent context (e.g. class name)
      let parentContext: string | undefined;
      const parent = node.parent;
      if (parent?.type === 'class_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) parentContext = nameNode.text;
      }

      chunks.push({
        content,
        type: node.type,
        startLine,
        endLine: node.endPosition.row + 1,
        method: 'ast',
        metadata: { language: lang, filePath, parentContext },
      });
    }

    if (cursor.gotoFirstChild()) {
      do { traverse(); } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };

  traverse();

  // If the tree yielded no extractable nodes, return the whole file
  if (chunks.length === 0) {
    return [{
      content: sourceCode,
      type: 'file',
      startLine: 1,
      endLine: sourceCode.split('\n').length,
      method: 'ast',
      metadata: { language: lang, filePath },
    }];
  }

  return chunks;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Chunk a document using AST parsing (when available) or text fallback.
 *
 * @param content  - raw file content
 * @param filePath - file path (used for language detection and metadata)
 * @param options  - optional chunking configuration
 * @returns array of ChunkResult with content, metadata, and method indicator
 */
export async function chunkDocument(
  content: string,
  filePath: string,
  options?: ChunkOptions,
): Promise<ChunkResult[]> {
  const lang = detectLanguage(filePath);

  // --- Determine whether to attempt AST ---
  const forceText = options?.skipAst || options?.forceTextFallback;

  if (forceText || !isASTLanguage(lang)) {
    return chunkText(content, filePath, lang, {
      maxChunkTokens: options?.maxChunkTokens,
      overlapSentences: options?.overlapSentences,
      documentTitle: options?.documentTitle,
      documentType: options?.documentType,
    });
  }

  // --- Size guard ---
  const guard = checkSizeGuard(content, filePath);
  if (guard.skip) {
    console.log(`chunkDocument: falling back to text chunking — ${guard.reason}`);
    return chunkText(content, filePath, lang, {
      maxChunkTokens: options?.maxChunkTokens,
      overlapSentences: options?.overlapSentences,
      documentTitle: options?.documentTitle,
      documentType: options?.documentType,
    });
  }

  // --- AST path ---
  const coreReady = await wasmLoader.initCore();
  if (!coreReady) {
    return chunkText(content, filePath, lang, {
      maxChunkTokens: options?.maxChunkTokens,
      overlapSentences: options?.overlapSentences,
      documentTitle: options?.documentTitle,
      documentType: options?.documentType,
    });
  }

  const language = await wasmLoader.loadLanguage(lang);
  if (!language) {
    console.warn(`chunkDocument: grammar unavailable for ${lang}, using text fallback`);
    return chunkText(content, filePath, lang, {
      maxChunkTokens: options?.maxChunkTokens,
      overlapSentences: options?.overlapSentences,
      documentTitle: options?.documentTitle,
      documentType: options?.documentType,
    });
  }

  try {
    const parser = wasmLoader.getParser();
    parser.setLanguage(language);
    const tree = parser.parse(content);
    const chunks = extractChunksFromTree(tree, content, lang, filePath);
    console.log(`chunkDocument: AST parsed ${filePath} into ${chunks.length} chunks`);
    return chunks;
  } catch (error) {
    console.warn(`chunkDocument: AST parse failed for ${filePath}, using text fallback:`, error);
    return chunkText(content, filePath, lang, {
      maxChunkTokens: options?.maxChunkTokens,
      overlapSentences: options?.overlapSentences,
      documentTitle: options?.documentTitle,
      documentType: options?.documentType,
    });
  }
}
