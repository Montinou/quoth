/**
 * Quoth Services Export
 * Central export for all Quoth functionality
 *
 * NOTE: search, tools, activity, drift, health modules have been removed.
 * Search is now at @/lib/search/pipeline (v2 Drizzle-based).
 * Tools registration is at @/lib/mcp/register.
 */

// Core Types
export * from './types';

// Prompts & Personas
export * from './prompt-constants';
export * from './prompts';

// Genesis (Documentation Bootstrap)
export * from './genesis';

// Guidelines
export * from './guidelines';

// Coverage
export {
  getLatestCoverage,
  type CoverageResult,
  type CoverageBreakdown,
  type DocType,
} from './coverage';
