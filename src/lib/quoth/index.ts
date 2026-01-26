/**
 * Quoth Services Export
 * Central export for all Quoth functionality
 */

// Core Types
export * from './types';

// Search & RAG Pipeline
export * from './search';

// MCP Tools Registration
export * from './tools';

// Prompts & Personas
export * from './prompt-constants';
export * from './prompts';

// Genesis (Documentation Bootstrap)
export * from './genesis';

// Activity & Analytics
export {
  logActivity,
  createActivityLogger,
  getActivitySummary,
  getMissRateTrends,
  getTopMissedQueries,
  type ActivityEventType,
  type ActivityLogParams,
} from './activity';

// Coverage
export {
  calculateCoverage,
  saveCoverageSnapshot,
  getLatestCoverage,
  type CoverageResult,
  type DocType,
} from './coverage';

// Drift Detection
export {
  detectDrift,
  getDriftTimeline,
  getDriftSummary,
  resolveDrift,
  type DriftSeverity,
  type DriftType,
  type DriftEvent,
  type DetectDriftParams,
} from './drift';

// Document Health
export {
  calculateStaleness,
  getDocumentHealth,
  getProjectHealth,
  getDocumentsNeedingAttention,
  type StalenessLevel,
  type StalenessResult,
  type DocumentHealth,
  type ProjectHealthSummary,
} from './health';
