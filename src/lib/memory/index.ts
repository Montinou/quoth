/**
 * Agent Memory Service — MEM-02
 * Re-exports types and service functions.
 */

export type {
  MemoryEntry,
  StoreMemoryInput,
  SearchMemoryInput,
  SearchMemoryResult,
  ListMemoryOptions,
} from "./types";

export {
  storeMemory,
  searchMemory,
  getMemory,
  listMemory,
  forgetMemory,
  forgetNamespace,
} from "./service";
