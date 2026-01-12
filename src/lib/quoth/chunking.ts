
// @ts-ignore
// import Parser from 'web-tree-sitter'; 
// Commenting out parser to avoid build errors with missing WASM or Types

import path from 'path';

/**
 * Supported languages for AST analysis
 */
export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

/**
 * Interface for a semantic chunk of code
 */
export interface CodeChunk {
  content: string;
  type: string;
  startLine: number;
  endLine: number;
  metadata: {
    language: SupportedLanguage;
    filePath: string;
    parentContext?: string; // e.g., Class Name for a method
  };
}

/**
 * AST Chunker Service
 * Temporarily running in Fallback Mode (Text/Header Splitting)
 * due to WASM build complications in Vercel.
 */
export class ASTChunker {
  private initialized = false;

  async init(): Promise<void> {
    // No-op for now
    this.initialized = true;
    console.log("ASTChunker initialized in FALLBACK mode.");
  }

  async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    // Direct fallback to robust text/header splitting
    return this.fallbackChunking(content, filePath);
  }

  private fallbackChunking(content: string, filePath: string): CodeChunk[] {
     // Split by H2 headers if markdown, or generic double-newline for code
     const isMarkdown = filePath.endsWith('.md');
     
     if (isMarkdown) {
        const chunks = content.split(/^## /gm).map(c => c.trim()).filter(c => c.length > 0);
        return chunks.map((c, i) => ({
             content: c.startsWith('## ') ? c : `## ${c}`, // loose reconstruction
             type: 'markdown_section',
             startLine: 1, // lost track
             endLine: 1,
             metadata: { language: 'javascript', filePath }
        }));
     }

     // Code files: simple split
     const blocks = content.split(/\n\n+/); 
     // Return one big chunk if small, or split blocks.
     // For RAG, let's keep it relatively granular but simple.
     // Actually, let's just return the whole file as one chunk or split by large gaps
     // to avoid breaking things too much. 
     // Better yet, reuse the header logic for consistency if applicable, but for code 
     // usually functions are separated by newlines.
     
     return blocks.map((b, i) => ({
        content: b,
        type: 'text_block',
        startLine: 1,
        endLine: 1,
        metadata: { language: 'typescript', filePath }
     }));
  }
}

export const astChunker = new ASTChunker();
