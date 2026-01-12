import fs from "fs";
import path from "path";

/**
 * Supported languages for AST analysis
 */
export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "markdown"
  | "text";

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
    parentContext?: string;
  };
}

/**
 * Multi-path resolution for WASM files (works on both local and Vercel)
 * Prioritizes public/wasm directory which contains self-built compatible WASM files
 */
function resolveWasmPath(wasmFileName: string): string | null {
  const candidates = [
    // Primary: public/wasm directory with self-built WASM files
    path.join(process.cwd(), "public", "wasm", wasmFileName),
    // Vercel serverless - .next/static
    path.join(process.cwd(), ".next", "static", "wasm", wasmFileName),
    // Fallback: node_modules/web-tree-sitter (for main WASM)
    path.join(process.cwd(), "node_modules", "web-tree-sitter", wasmFileName),
    // Vercel serverless - .next/server structure
    path.join(
      process.cwd(),
      ".next",
      "server",
      "node_modules",
      "web-tree-sitter",
      wasmFileName
    ),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore filesystem errors and try next candidate
    }
  }

  return null;
}

/**
 * Extractable node types by language
 */
const EXTRACTABLE_TYPES: Record<string, string[]> = {
  typescript: [
    "function_declaration",
    "class_declaration",
    "method_definition",
    "arrow_function",
    "lexical_declaration",
    "export_statement",
    "interface_declaration",
    "type_alias_declaration",
  ],
  javascript: [
    "function_declaration",
    "class_declaration",
    "method_definition",
    "arrow_function",
    "lexical_declaration",
    "export_statement",
  ],
  python: [
    "function_definition",
    "class_definition",
    "decorated_definition",
  ],
};

/**
 * Map file extensions to language names
 */
function getLanguageFromPath(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".md":
    case ".mdx":
      return "markdown";
    default:
      return "text";
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AST Chunker Service
 * Uses tree-sitter for semantic code chunking with fallback for non-code files
 */
export class ASTChunker {
  private ParserClass: any = null;
  private LanguageClass: any = null;
  private parser: any = null;
  private languages: Map<string, any> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private astEnabled = false;

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (this.initialized) return;

    // Check if AST is disabled via environment variable
    if (process.env.DISABLE_AST_CHUNKING === "true") {
      console.log("ASTChunker: AST disabled via DISABLE_AST_CHUNKING env var");
      this.initialized = true;
      this.astEnabled = false;
      return;
    }

    try {
      // Dynamic import of web-tree-sitter
      const TreeSitter = await import("web-tree-sitter");
      // web-tree-sitter exports Parser and Language as named exports
      this.ParserClass = TreeSitter.Parser;
      this.LanguageClass = TreeSitter.Language;

      // Find and load web-tree-sitter.wasm
      const treeSitterWasmPath = resolveWasmPath("web-tree-sitter.wasm");

      if (!treeSitterWasmPath) {
        console.warn(
          "ASTChunker: tree-sitter.wasm not found, falling back to text chunking"
        );
        this.initialized = true;
        this.astEnabled = false;
        return;
      }

      // Initialize with wasmBinary to avoid locateFile issues
      const wasmBinary = fs.readFileSync(treeSitterWasmPath);
      await this.ParserClass.init({ wasmBinary });

      this.parser = new this.ParserClass();
      this.astEnabled = true;
      console.log("ASTChunker: Initialized with tree-sitter AST parsing");
    } catch (error) {
      console.warn("ASTChunker: Failed to initialize tree-sitter:", error);
      this.astEnabled = false;
    }

    this.initialized = true;
  }

  /**
   * Load a language grammar for parsing
   */
  private async loadLanguage(
    lang: "typescript" | "javascript" | "python"
  ): Promise<any | null> {
    if (!this.LanguageClass || !this.astEnabled) return null;

    // Check cache first
    if (this.languages.has(lang)) {
      return this.languages.get(lang)!;
    }

    // Map language to WASM file name
    const wasmFileName = `tree-sitter-${lang}.wasm`;
    const wasmPath = resolveWasmPath(wasmFileName);

    if (!wasmPath) {
      console.warn(`ASTChunker: Language WASM not found for ${lang}`);
      return null;
    }

    try {
      // Read WASM binary and load it
      const wasmBinary = fs.readFileSync(wasmPath);
      const language = await this.LanguageClass.load(wasmBinary);
      this.languages.set(lang, language);
      return language;
    } catch (error) {
      console.warn(`ASTChunker: Failed to load language ${lang}:`, error);
      return null;
    }
  }

  /**
   * Extract semantic chunks from AST
   */
  private extractChunksFromTree(
    tree: any,
    sourceCode: string,
    lang: SupportedLanguage,
    filePath: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const extractableTypes = EXTRACTABLE_TYPES[lang] || [];

    if (extractableTypes.length === 0) {
      return [
        {
          content: sourceCode,
          type: "file",
          startLine: 1,
          endLine: sourceCode.split("\n").length,
          metadata: { language: lang, filePath },
        },
      ];
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

        // Check for preceding comment
        const prevSibling = node.previousSibling;
        if (prevSibling && prevSibling.type === "comment") {
          content =
            sourceCode.slice(prevSibling.startIndex, prevSibling.endIndex) +
            "\n" +
            content;
          startLine = prevSibling.startPosition.row + 1;
        }

        // Determine parent context
        let parentContext: string | undefined;
        const parent = node.parent;
        if (parent && parent.type === "class_declaration") {
          const nameNode = parent.childForFieldName("name");
          if (nameNode) {
            parentContext = nameNode.text;
          }
        }

        chunks.push({
          content,
          type: node.type,
          startLine,
          endLine: node.endPosition.row + 1,
          metadata: {
            language: lang,
            filePath,
            parentContext,
          },
        });
      }

      if (cursor.gotoFirstChild()) {
        do {
          traverse();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    traverse();

    if (chunks.length === 0) {
      return [
        {
          content: sourceCode,
          type: "file",
          startLine: 1,
          endLine: sourceCode.split("\n").length,
          metadata: { language: lang, filePath },
        },
      ];
    }

    return chunks;
  }

  /**
   * Fallback chunking for markdown and unsupported files
   */
  private fallbackChunking(content: string, filePath: string): CodeChunk[] {
    const lang = getLanguageFromPath(filePath);

    if (lang === "markdown") {
      const sections = content.split(/^## /gm);
      const chunks: CodeChunk[] = [];
      let currentLine = 1;

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        if (!section) continue;

        const sectionContent = i === 0 ? section : `## ${section}`;
        const lineCount = sectionContent.split("\n").length;

        chunks.push({
          content: sectionContent,
          type: "markdown_section",
          startLine: currentLine,
          endLine: currentLine + lineCount - 1,
          metadata: { language: "markdown", filePath },
        });

        currentLine += lineCount;
      }

      return chunks.length > 0
        ? chunks
        : [
            {
              content,
              type: "file",
              startLine: 1,
              endLine: content.split("\n").length,
              metadata: { language: "markdown", filePath },
            },
          ];
    }

    // For code files without AST support, split by double newlines
    const blocks = content.split(/\n\n+/);
    const chunks: CodeChunk[] = [];
    let currentLine = 1;

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lineCount = block.split("\n").length;
      chunks.push({
        content: block,
        type: "text_block",
        startLine: currentLine,
        endLine: currentLine + lineCount - 1,
        metadata: { language: lang, filePath },
      });

      currentLine += lineCount + 1;
    }

    return chunks.length > 0
      ? chunks
      : [
          {
            content,
            type: "file",
            startLine: 1,
            endLine: content.split("\n").length,
            metadata: { language: lang, filePath },
          },
        ];
  }

  /**
   * Main entry point: chunk a file using AST or fallback
   */
  async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    await this.init();

    const lang = getLanguageFromPath(filePath);

    // Use fallback for markdown and text files
    if (lang === "markdown" || lang === "text") {
      return this.fallbackChunking(content, filePath);
    }

    // Try AST parsing for code files
    if (this.astEnabled && this.parser) {
      const treeSitterLang =
        lang === "typescript" || lang === "javascript" || lang === "python"
          ? lang
          : null;

      if (treeSitterLang) {
        const language = await this.loadLanguage(treeSitterLang);

        if (language) {
          try {
            this.parser.setLanguage(language);
            const tree = this.parser.parse(content);
            const chunks = this.extractChunksFromTree(
              tree,
              content,
              lang,
              filePath
            );
            console.log(
              `ASTChunker: Parsed ${filePath} into ${chunks.length} semantic chunks`
            );
            return chunks;
          } catch (error) {
            console.warn(
              `ASTChunker: Failed to parse ${filePath}, using fallback:`,
              error
            );
          }
        }
      }
    }

    return this.fallbackChunking(content, filePath);
  }

  /**
   * Check if AST parsing is enabled
   */
  isASTEnabled(): boolean {
    return this.astEnabled;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export const astChunker = new ASTChunker();
