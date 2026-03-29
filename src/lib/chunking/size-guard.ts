/**
 * File size protection for AST chunking (QUOTH-10)
 *
 * Prevents tree-sitter from choking on enormous files by enforcing:
 *  - Max file size in bytes (default 500 KB)
 *  - Max line count (default 10 000)
 *  - WASM heap memory warning (default 256 MB)
 *
 * When a guard trips, it returns a reason string; callers log it and
 * fall back to the text chunker.
 */

import { SIZE_GUARD_DEFAULTS } from './types';

export interface SizeGuardOptions {
  maxFileSizeBytes?: number;
  maxFileLines?: number;
  wasmMemoryWarnBytes?: number;
}

export interface SizeGuardResult {
  /** Whether AST chunking should be skipped. */
  skip: boolean;
  /** Human-readable reason when skip is true. */
  reason?: string;
}

/**
 * Evaluate whether a file should skip AST chunking.
 *
 * @param content  - raw file content
 * @param filePath - path (for logging only)
 * @param opts     - override default thresholds
 */
export function checkSizeGuard(
  content: string,
  filePath: string,
  opts?: SizeGuardOptions,
): SizeGuardResult {
  const maxBytes = opts?.maxFileSizeBytes ?? SIZE_GUARD_DEFAULTS.maxFileSizeBytes;
  const maxLines = opts?.maxFileLines ?? SIZE_GUARD_DEFAULTS.maxFileLines;
  const memWarn = opts?.wasmMemoryWarnBytes ?? SIZE_GUARD_DEFAULTS.wasmMemoryWarnBytes;

  // --- file size ---
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  if (sizeBytes > maxBytes) {
    const reason = `File too large for AST: ${(sizeBytes / 1024).toFixed(0)} KB > ${(maxBytes / 1024).toFixed(0)} KB limit — ${filePath}`;
    console.log(`SizeGuard: ${reason}`);
    return { skip: true, reason };
  }

  // --- line count ---
  const lineCount = content.split('\n').length;
  if (lineCount > maxLines) {
    const reason = `File too many lines for AST: ${lineCount} > ${maxLines} limit — ${filePath}`;
    console.log(`SizeGuard: ${reason}`);
    return { skip: true, reason };
  }

  // --- WASM memory warning (non-blocking) ---
  checkWasmMemory(memWarn);

  return { skip: false };
}

/**
 * Warn if the process RSS suggests WASM is using excessive memory.
 * This is a best-effort heuristic — WASM heaps show up in RSS.
 */
function checkWasmMemory(warnBytes: number): void {
  try {
    const usage = process.memoryUsage();
    // arrayBuffers is where WASM linear memory lives in Node
    if (usage.arrayBuffers > warnBytes) {
      console.warn(
        `SizeGuard: WASM memory high — arrayBuffers ${(usage.arrayBuffers / 1024 / 1024).toFixed(1)} MB exceeds ${(warnBytes / 1024 / 1024).toFixed(0)} MB threshold`,
      );
    }
  } catch {
    // memoryUsage can throw in constrained environments
  }
}
