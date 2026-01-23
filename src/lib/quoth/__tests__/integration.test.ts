/**
 * Phase 3 Insights Integration Test
 * Verifies all Phase 3 exports are accessible from @/lib/quoth
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Supabase before any imports that might use it
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

import {
  // Activity & Analytics
  logActivity,
  createActivityLogger,
  getActivitySummary,
  getMissRateTrends,
  getTopMissedQueries,
  type ActivityEventType,
  type ActivityLogParams,

  // Coverage
  calculateCoverage,
  saveCoverageSnapshot,
  getLatestCoverage,
  type CoverageResult,

  // Drift Detection
  detectDrift,
  getDriftTimeline,
  getDriftSummary,
  resolveDrift,
  type DriftSeverity,
  type DriftType,
  type DriftEvent,
  type DetectDriftParams,

  // Document Health
  calculateStaleness,
  getDocumentHealth,
  getProjectHealth,
  getDocumentsNeedingAttention,
  type StalenessLevel,
  type StalenessResult,
  type DocumentHealth,
  type ProjectHealthSummary,
} from '@/lib/quoth';

describe('Phase 3 Insights Exports', () => {
  describe('Activity & Analytics', () => {
    it('exports logActivity function', () => {
      expect(typeof logActivity).toBe('function');
    });

    it('exports createActivityLogger function', () => {
      expect(typeof createActivityLogger).toBe('function');
    });

    it('exports getActivitySummary function', () => {
      expect(typeof getActivitySummary).toBe('function');
    });

    it('exports getMissRateTrends function', () => {
      expect(typeof getMissRateTrends).toBe('function');
    });

    it('exports getTopMissedQueries function', () => {
      expect(typeof getTopMissedQueries).toBe('function');
    });

    it('supports ActivityEventType type', () => {
      // Type-safe variable assignment
      const eventType: ActivityEventType = 'search';
      expect(eventType).toBe('search');
    });

    it('supports ActivityLogParams type', () => {
      // Type-safe variable assignment
      const params: ActivityLogParams = {
        projectId: 'test-project',
        eventType: 'search',
        query: 'test query',
      };
      expect(params.projectId).toBe('test-project');
      expect(params.eventType).toBe('search');
    });
  });

  describe('Coverage', () => {
    it('exports calculateCoverage function', () => {
      expect(typeof calculateCoverage).toBe('function');
    });

    it('exports saveCoverageSnapshot function', () => {
      expect(typeof saveCoverageSnapshot).toBe('function');
    });

    it('exports getLatestCoverage function', () => {
      expect(typeof getLatestCoverage).toBe('function');
    });

    it('supports CoverageResult type', () => {
      // Type-safe variable assignment
      const result: CoverageResult = {
        totalDocuments: 10,
        documentedPatterns: 8,
        coveragePercentage: 80,
        missingAreas: ['api-contracts'],
        recommendations: ['Add API documentation'],
      };
      expect(result.coveragePercentage).toBe(80);
    });
  });

  describe('Drift Detection', () => {
    it('exports detectDrift function', () => {
      expect(typeof detectDrift).toBe('function');
    });

    it('exports getDriftTimeline function', () => {
      expect(typeof getDriftTimeline).toBe('function');
    });

    it('exports getDriftSummary function', () => {
      expect(typeof getDriftSummary).toBe('function');
    });

    it('exports resolveDrift function', () => {
      expect(typeof resolveDrift).toBe('function');
    });

    it('supports DriftSeverity type', () => {
      // Type-safe variable assignment
      const severity: DriftSeverity = 'high';
      expect(['low', 'medium', 'high', 'critical']).toContain(severity);
    });

    it('supports DriftType type', () => {
      // Type-safe variable assignment
      const driftType: DriftType = 'outdated_content';
      expect(typeof driftType).toBe('string');
    });

    it('supports DriftEvent type', () => {
      // Type-safe variable assignment
      const event: DriftEvent = {
        id: 'drift-1',
        projectId: 'test-project',
        documentId: 'doc-1',
        documentTitle: 'Test Doc',
        driftType: 'outdated_content',
        severity: 'medium',
        description: 'Content is outdated',
        detectedAt: new Date().toISOString(),
        resolved: false,
      };
      expect(event.driftType).toBe('outdated_content');
    });

    it('supports DetectDriftParams type', () => {
      // Type-safe variable assignment
      const params: DetectDriftParams = {
        projectId: 'test-project',
      };
      expect(params.projectId).toBe('test-project');
    });
  });

  describe('Document Health', () => {
    it('exports calculateStaleness function', () => {
      expect(typeof calculateStaleness).toBe('function');
    });

    it('exports getDocumentHealth function', () => {
      expect(typeof getDocumentHealth).toBe('function');
    });

    it('exports getProjectHealth function', () => {
      expect(typeof getProjectHealth).toBe('function');
    });

    it('exports getDocumentsNeedingAttention function', () => {
      expect(typeof getDocumentsNeedingAttention).toBe('function');
    });

    it('supports StalenessLevel type', () => {
      // Type-safe variable assignment
      const level: StalenessLevel = 'fresh';
      expect(['fresh', 'aging', 'stale', 'critical']).toContain(level);
    });

    it('supports StalenessResult type', () => {
      // Type-safe variable assignment
      const result: StalenessResult = {
        level: 'fresh',
        daysSinceUpdate: 5,
        lastUpdated: new Date().toISOString(),
      };
      expect(result.level).toBe('fresh');
    });

    it('supports DocumentHealth type', () => {
      // Type-safe variable assignment
      const health: DocumentHealth = {
        documentId: 'doc-1',
        title: 'Test Document',
        staleness: {
          level: 'fresh',
          daysSinceUpdate: 5,
          lastUpdated: new Date().toISOString(),
        },
        searchHits: 10,
        lastAccessed: new Date().toISOString(),
        healthScore: 85,
      };
      expect(health.healthScore).toBe(85);
    });

    it('supports ProjectHealthSummary type', () => {
      // Type-safe variable assignment
      const summary: ProjectHealthSummary = {
        projectId: 'test-project',
        totalDocuments: 10,
        healthyDocuments: 8,
        staleDocuments: 2,
        averageHealthScore: 80,
        documentsNeedingAttention: [],
      };
      expect(summary.averageHealthScore).toBe(80);
    });
  });
});
