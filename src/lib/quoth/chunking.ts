// @ts-ignore
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Parser = require('web-tree-sitter');

// ... existing types ...

/**
 * AST Chunker Service
 */
export class ASTChunker {
  private parser: Parser | null = null;
  private grammars: Map<SupportedLanguage, Parser.Language> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await Parser.init({
        locateFile(scriptName: string, scriptDirectory: string) {
          return path.join(process.cwd(), 'node_modules', 'web-tree-sitter', scriptName);
        },
      });
      this.parser = new Parser();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize AST parser:', error);
      throw new Error('AST Parser initialization failed');
    }
  }

  /**
   * Load grammar for a specific language
   */
  private async loadLanguage(lang: SupportedLanguage): Promise<void> {
    if (this.grammars.has(lang)) {
      this.parser?.setLanguage(this.grammars.get(lang));
      return;
    }

    try {
      // In a real implementation, we need to map languages to their WASM paths
      // This is a placeholder for the actual loading logic which often involves
      // resolving the path to tree-sitter-[lang].wasm
      const language = await Parser.Language.load(
        require.resolve(`tree-sitter-${lang}/tree-sitter-${lang}.wasm`)
      );
      
      this.grammars.set(lang, language);
      this.parser?.setLanguage(language);
    } catch (error) {
      console.warn(`Could not load grammar for ${lang}, falling back to non-AST splitting`, error);
      throw error;
    }
  }

  /**
   * Main chunking method
   */
  async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    if (!this.initialized) await this.init();

    const lang = this.detectLanguage(filePath);
    if (!lang) {
      // Fallback: simple line/paragraph splitting for non-code files
      return this.fallbackChunking(content, filePath);
    }

    try {
      await this.loadLanguage(lang);
      const tree = this.parser!.parse(content);
      return this.extractChunks(tree.rootNode, content, lang, filePath);
    } catch (error) {
      console.warn(`AST Extract failed for ${filePath}, using fallback`, error);
      return this.fallbackChunking(content, filePath);
    }
  }

  private detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.py':
        return 'python';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      default:
        return null;
    }
  }

  /**
   * Traverse AST and extract meaningful blocks
   */
  private extractChunks(
    node: Parser.SyntaxNode,
    source: string,
    lang: SupportedLanguage,
    filePath: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const relevantTypes = new Set([
      'function_declaration',
      'method_definition',
      'class_declaration',
      'interface_declaration',
      'class_definition', // python
      'function_definition', // python
    ]);

    // Simple recursive traversal
    // Taking the top-level relevant nodes or their significant children
    // In a complex file, we might want a flattened list of all functions even if nested
    
    // Using a cursor for efficiency is possible, but simple traversal works for now
    const traverse = (currentNode: Parser.SyntaxNode, context: string | undefined) => {
      // Check if this node is interesting
      if (relevantTypes.has(currentNode.type)) {
        // Capture docstrings/comments if they immediately precede the node
        // (Simplified logic: taking the node text essentially captures the body. 
        //  Comments are siblings in tree-sitter usually, unless wrapped)
        
        const chunk: CodeChunk = {
          content: currentNode.text,
          type: currentNode.type,
          startLine: currentNode.startPosition.row + 1,
          endLine: currentNode.endPosition.row + 1,
          metadata: {
            language: lang,
            filePath,
            parentContext: context
          }
        };
        chunks.push(chunk);

        // For classes, we might want to traverse inside to get methods separately
        // if the class is too huge. But "preserving structural integrity" usually means 
        // keeping class cohesion. Standard RAG often benefits from splitting huge classes though.
        // Let's recurse into classes to see if we should split methods too.
        if (currentNode.type.includes('class') || currentNode.type.includes('interface')) {
           currentNode.children.forEach(child => traverse(child, currentNode.text.split('\n')[0])); 
           return; 
        }
      } else {
        currentNode.children.forEach(child => traverse(child, context));
      }
    };

    traverse(node, undefined);

    // If no structural chunks found (e.g. script file with just global code), fallback
    if (chunks.length === 0 && source.trim().length > 0) {
       return this.fallbackChunking(source, filePath);
    }

    return chunks;
  }

  private fallbackChunking(content: string, filePath: string): CodeChunk[] {
     // Reuse logic similar to splitting by headers but generalized
     // For now, simple return of the whole file if small, or split by double newlines
     return [{
       content: content,
       type: 'text_blob',
       startLine: 1,
       endLine: content.split('\n').length,
       metadata: {
         language: 'javascript', // dummy
         filePath
       }
     }] as CodeChunk[]; // casting for simplicity
  }
}

export const astChunker = new ASTChunker();
