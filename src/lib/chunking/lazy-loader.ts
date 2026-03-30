/**
 * Lazy per-language WASM loader (QUOTH-10)
 *
 * Only loads the 192 KB `web-tree-sitter.wasm` core on init.
 * Language grammars (400 KB-1.4 MB each) are loaded on first use
 * and cached in a Map for subsequent calls.
 *
 * Timeouts: 10 s for core init, 5 s per language load.
 */

import fs from 'fs';
import path from 'path';
import type {
  ASTLanguage,
  LoaderProgressCallback,
  LoaderProgressEvent,
} from './types';

// ---------------------------------------------------------------------------
// Timeout helpers
// ---------------------------------------------------------------------------

const CORE_INIT_TIMEOUT_MS = 10_000;
const LANGUAGE_LOAD_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// WASM path resolution (multi-path: local dev, Vercel serverless)
// ---------------------------------------------------------------------------

function resolveWasmPath(wasmFileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), 'public', 'wasm', wasmFileName),
    path.join(process.cwd(), '.next', 'static', 'wasm', wasmFileName),
    path.join(process.cwd(), 'node_modules', 'web-tree-sitter', wasmFileName),
    path.join(process.cwd(), '.next', 'server', 'node_modules', 'web-tree-sitter', wasmFileName),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore and try next
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Loader class
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

export class LazyWasmLoader {
  // Core tree-sitter classes (populated after init)
  private ParserClass: any = null;
  private LanguageClass: any = null;
  private parser: any = null;

  // Per-language cache
  private languages: Map<ASTLanguage, any> = new Map();

  // Deduplication promises
  private coreInitPromise: Promise<void> | null = null;
  private languageLoadPromises: Map<ASTLanguage, Promise<any | null>> = new Map();

  // State
  private coreReady = false;
  private disabled = false;

  // Optional progress callback
  private onProgress: LoaderProgressCallback | null = null;

  /** Set an optional progress callback. */
  setProgressCallback(cb: LoaderProgressCallback | null): void {
    this.onProgress = cb;
  }

  private emit(event: LoaderProgressEvent): void {
    try { this.onProgress?.(event); } catch { /* caller error — ignore */ }
  }

  // -----------------------------------------------------------------------
  // Core init — loads only web-tree-sitter.wasm (192 KB)
  // -----------------------------------------------------------------------

  /** Initialise the tree-sitter core. Safe to call multiple times. */
  async initCore(): Promise<boolean> {
    if (this.disabled) return false;
    if (this.coreReady) return true;

    if (!this.coreInitPromise) {
      this.coreInitPromise = this._doInitCore();
    }

    try {
      await this.coreInitPromise;
      return this.coreReady;
    } catch {
      this.disabled = true;
      return false;
    }
  }

  private async _doInitCore(): Promise<void> {
    if (process.env.DISABLE_AST_CHUNKING === 'true') {
      console.log('LazyWasmLoader: AST disabled via DISABLE_AST_CHUNKING env var');
      this.disabled = true;
      return;
    }

    this.emit({ stage: 'core-init' });

    const treeSitter = await withTimeout(
      import('web-tree-sitter'),
      CORE_INIT_TIMEOUT_MS,
      'web-tree-sitter import',
    );

    this.ParserClass = treeSitter.Parser;
    this.LanguageClass = treeSitter.Language;

    const wasmPath = resolveWasmPath('web-tree-sitter.wasm');
    if (!wasmPath) {
      console.warn('LazyWasmLoader: web-tree-sitter.wasm not found — AST disabled');
      this.disabled = true;
      return;
    }

    const wasmBinary = fs.readFileSync(wasmPath);
    await withTimeout(
      this.ParserClass.init({ wasmBinary }),
      CORE_INIT_TIMEOUT_MS,
      'Parser.init',
    );

    this.parser = new this.ParserClass();
    this.coreReady = true;
    console.log('LazyWasmLoader: core initialised (web-tree-sitter.wasm loaded)');
  }

  // -----------------------------------------------------------------------
  // On-demand language loading
  // -----------------------------------------------------------------------

  /**
   * Load a language grammar on demand. Returns the Language object or null.
   * Results are cached — subsequent calls for the same language are instant.
   */
  async loadLanguage(lang: ASTLanguage): Promise<any | null> {
    if (this.disabled || !this.coreReady) return null;

    // Cache hit
    if (this.languages.has(lang)) return this.languages.get(lang)!;

    // Deduplicate concurrent loads for the same language
    if (!this.languageLoadPromises.has(lang)) {
      this.languageLoadPromises.set(lang, this._doLoadLanguage(lang));
    }

    return this.languageLoadPromises.get(lang)!;
  }

  private async _doLoadLanguage(lang: ASTLanguage): Promise<any | null> {
    this.emit({ stage: 'language-load', language: lang });

    const wasmPath = resolveWasmPath(`tree-sitter-${lang}.wasm`);
    if (!wasmPath) {
      console.warn(`LazyWasmLoader: tree-sitter-${lang}.wasm not found`);
      return null;
    }

    try {
      const wasmBinary = fs.readFileSync(wasmPath);
      const language = await withTimeout(
        this.LanguageClass.load(wasmBinary),
        LANGUAGE_LOAD_TIMEOUT_MS,
        `Language.load(${lang})`,
      );
      this.languages.set(lang, language);
      console.log(`LazyWasmLoader: loaded grammar for ${lang}`);
      return language;
    } catch (error) {
      console.warn(`LazyWasmLoader: failed to load ${lang}:`, error);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Get the parser instance (only valid after initCore resolves true). */
  getParser(): any | null {
    return this.parser;
  }

  /** Whether the core is initialised and AST parsing is available. */
  isReady(): boolean {
    return this.coreReady && !this.disabled;
  }

  /** Whether AST has been explicitly disabled. */
  isDisabled(): boolean {
    return this.disabled;
  }

  /** Languages currently cached. */
  get cachedLanguages(): ASTLanguage[] {
    return [...this.languages.keys()];
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Shared singleton — import this in other modules. */
export const wasmLoader = new LazyWasmLoader();
