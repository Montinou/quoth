# Phase 3: Insights Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build full observability into documentation health with drift detection, staleness indicators, miss rate analytics, and weekly health reports.

**Architecture:** Extend existing activity logging and coverage systems with drift event capture, document staleness calculation, enhanced miss rate visualization, and scheduled email reports using Resend + React Email.

**Tech Stack:** Next.js 16, Supabase (PostgreSQL), Resend, React Email, Lucide icons, Tailwind v4

---

## Prerequisites

- Phase 1 & 2 must be complete (activity logging table, coverage snapshots exist)
- Resend configured with `RESEND_API_KEY` environment variable
- Project has `quoth_activity` and `coverage_snapshot` tables

---

## Task 1: Database Schema for Drift Detection

**Files:**
- Create: `supabase/migrations/024_drift_detection.sql`

**Step 1: Write the migration file**

```sql
-- ==============================================
-- Migration 024: Drift Detection Schema
-- Purpose: Track documentation drift events with severity
-- ==============================================

BEGIN;

-- Drift events table for timeline visualization
CREATE TABLE IF NOT EXISTS drift_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- Drift details
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  drift_type TEXT NOT NULL CHECK (drift_type IN (
    'code_diverged',       -- Code doesn't match documented pattern
    'missing_doc',         -- Code exists without documentation
    'stale_doc',           -- Document hasn't been updated
    'pattern_violation'    -- Code violates documented pattern
  )),

  -- Context
  file_path TEXT NOT NULL,          -- Code file that triggered drift
  doc_path TEXT,                    -- Related document path
  description TEXT NOT NULL,        -- Human-readable description
  expected_pattern TEXT,            -- What doc says
  actual_code TEXT,                 -- What code does

  -- Resolution
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  resolution_note TEXT,

  -- Timestamps
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for timeline queries
CREATE INDEX idx_drift_events_project_detected ON drift_events(project_id, detected_at DESC);
CREATE INDEX idx_drift_events_severity ON drift_events(project_id, severity);
CREATE INDEX idx_drift_events_unresolved ON drift_events(project_id, resolved) WHERE resolved = false;

-- RLS policies
ALTER TABLE drift_events ENABLE ROW LEVEL SECURITY;

-- Users can view drift events for their projects
CREATE POLICY "Users can view drift events for their projects"
  ON drift_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = drift_events.project_id
        AND pm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = drift_events.project_id
        AND p.is_public = true
    )
  );

-- Editors and admins can insert/update drift events
CREATE POLICY "Editors can manage drift events"
  ON drift_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = drift_events.project_id
        AND pm.user_id = auth.uid()
        AND pm.role IN ('admin', 'editor')
    )
  );

-- Service role can insert (for plugin hooks)
CREATE POLICY "Service role can insert drift events"
  ON drift_events FOR INSERT
  WITH CHECK (true);

GRANT SELECT ON drift_events TO authenticated;
GRANT INSERT, UPDATE ON drift_events TO authenticated;

COMMENT ON TABLE drift_events IS 'Tracks documentation drift events for timeline visualization';

COMMIT;
```

**Step 2: Apply the migration**

Run: `PGPASSWORD="$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2 | tr -d '"')" psql "$(grep POSTGRES_URL_NON_POOLING .env | cut -d '=' -f2 | tr -d '"')" -f supabase/migrations/024_drift_detection.sql`
Expected: `BEGIN`, `CREATE TABLE`, `CREATE INDEX` (x3), `ALTER TABLE`, `CREATE POLICY` (x3), `GRANT`, `COMMENT`, `COMMIT`

**Step 3: Commit**

```bash
git add supabase/migrations/024_drift_detection.sql
git commit -m "feat: add drift_events table for Phase 3 insights"
```

---

## Task 2: Drift Detection Service

**Files:**
- Create: `src/lib/quoth/drift.ts`
- Test: `src/lib/quoth/__tests__/drift.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/quoth/__tests__/drift.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectDrift, DriftSeverity, DriftType } from '../drift';

// Mock Supabase
vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

describe('drift detection', () => {
  it('should classify missing documentation as warning severity', async () => {
    const result = await detectDrift({
      projectId: 'test-project',
      filePath: '/api/users/route.ts',
      driftType: 'missing_doc',
      description: 'API endpoint lacks documentation',
    });

    expect(result.severity).toBe('warning');
    expect(result.driftType).toBe('missing_doc');
  });

  it('should classify pattern violation as critical severity', async () => {
    const result = await detectDrift({
      projectId: 'test-project',
      filePath: '/lib/auth.ts',
      driftType: 'pattern_violation',
      description: 'Auth uses deprecated pattern',
      expectedPattern: 'Use Supabase SSR auth',
      actualCode: 'Using client-side auth',
    });

    expect(result.severity).toBe('critical');
  });

  it('should classify stale doc as info severity when < 30 days', async () => {
    const result = await detectDrift({
      projectId: 'test-project',
      filePath: '/patterns/auth.md',
      driftType: 'stale_doc',
      description: 'Document updated 20 days ago',
    });

    expect(result.severity).toBe('info');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/quoth/__tests__/drift.test.ts`
Expected: FAIL with "Cannot find module '../drift'"

**Step 3: Write the implementation**

```typescript
// src/lib/quoth/drift.ts
/**
 * Drift Detection Service
 * Detects and tracks documentation drift events
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type DriftSeverity = 'info' | 'warning' | 'critical';
export type DriftType = 'code_diverged' | 'missing_doc' | 'stale_doc' | 'pattern_violation';

export interface DriftEvent {
  id?: string;
  projectId: string;
  documentId?: string;
  severity: DriftSeverity;
  driftType: DriftType;
  filePath: string;
  docPath?: string;
  description: string;
  expectedPattern?: string;
  actualCode?: string;
  resolved?: boolean;
  detectedAt?: string;
}

export interface DetectDriftParams {
  projectId: string;
  documentId?: string;
  filePath: string;
  docPath?: string;
  driftType: DriftType;
  description: string;
  expectedPattern?: string;
  actualCode?: string;
}

/**
 * Determine severity based on drift type and context
 */
function calculateSeverity(driftType: DriftType, description: string): DriftSeverity {
  switch (driftType) {
    case 'pattern_violation':
      return 'critical';
    case 'code_diverged':
      return 'warning';
    case 'missing_doc':
      return 'warning';
    case 'stale_doc':
      // Check if description mentions days
      const daysMatch = description.match(/(\d+)\s*days?/i);
      if (daysMatch) {
        const days = parseInt(daysMatch[1], 10);
        if (days > 60) return 'warning';
        if (days > 90) return 'critical';
      }
      return 'info';
    default:
      return 'info';
  }
}

/**
 * Detect and record a drift event
 */
export async function detectDrift(params: DetectDriftParams): Promise<DriftEvent> {
  const severity = calculateSeverity(params.driftType, params.description);

  const driftEvent: DriftEvent = {
    projectId: params.projectId,
    documentId: params.documentId,
    severity,
    driftType: params.driftType,
    filePath: params.filePath,
    docPath: params.docPath,
    description: params.description,
    expectedPattern: params.expectedPattern,
    actualCode: params.actualCode,
    resolved: false,
    detectedAt: new Date().toISOString(),
  };

  // Save to database
  const { error } = await supabase.from('drift_events').insert({
    project_id: params.projectId,
    document_id: params.documentId || null,
    severity,
    drift_type: params.driftType,
    file_path: params.filePath,
    doc_path: params.docPath || null,
    description: params.description,
    expected_pattern: params.expectedPattern || null,
    actual_code: params.actualCode || null,
    resolved: false,
  });

  if (error) {
    console.error('[Drift] Failed to save drift event:', error.message);
  }

  return driftEvent;
}

/**
 * Get drift events for timeline visualization
 */
export async function getDriftTimeline(
  projectId: string,
  days: number = 30,
  includeResolved: boolean = false
): Promise<DriftEvent[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from('drift_events')
    .select('*')
    .eq('project_id', projectId)
    .gte('detected_at', since.toISOString())
    .order('detected_at', { ascending: false });

  if (!includeResolved) {
    query = query.eq('resolved', false);
  }

  const { data, error } = await query;

  if (error || !data) {
    console.error('[Drift] Failed to fetch timeline:', error?.message);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    severity: row.severity as DriftSeverity,
    driftType: row.drift_type as DriftType,
    filePath: row.file_path,
    docPath: row.doc_path,
    description: row.description,
    expectedPattern: row.expected_pattern,
    actualCode: row.actual_code,
    resolved: row.resolved,
    detectedAt: row.detected_at,
  }));
}

/**
 * Get drift summary counts by severity
 */
export async function getDriftSummary(projectId: string): Promise<{
  total: number;
  critical: number;
  warning: number;
  info: number;
  unresolvedCount: number;
}> {
  const { data, error } = await supabase
    .from('drift_events')
    .select('severity, resolved')
    .eq('project_id', projectId);

  if (error || !data) {
    return { total: 0, critical: 0, warning: 0, info: 0, unresolvedCount: 0 };
  }

  return {
    total: data.length,
    critical: data.filter((d) => d.severity === 'critical').length,
    warning: data.filter((d) => d.severity === 'warning').length,
    info: data.filter((d) => d.severity === 'info').length,
    unresolvedCount: data.filter((d) => !d.resolved).length,
  };
}

/**
 * Resolve a drift event
 */
export async function resolveDrift(
  driftId: string,
  userId: string,
  note?: string
): Promise<boolean> {
  const { error } = await supabase
    .from('drift_events')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_note: note || null,
    })
    .eq('id', driftId);

  if (error) {
    console.error('[Drift] Failed to resolve drift:', error.message);
    return false;
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/quoth/__tests__/drift.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/lib/quoth/drift.ts src/lib/quoth/__tests__/drift.test.ts
git commit -m "feat: add drift detection service with severity classification"
```

---

## Task 3: Drift API Endpoint

**Files:**
- Create: `src/app/api/projects/[projectId]/drift/route.ts`

**Step 1: Write the failing test**

```typescript
// src/app/api/projects/[projectId]/drift/__tests__/route.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('GET /api/projects/[projectId]/drift', () => {
  it('should return drift timeline for authenticated user', async () => {
    // Test will be integration-level, verify endpoint exists
    const response = await fetch('/api/projects/test-id/drift');
    expect(response).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/projects/[projectId]/drift`
Expected: FAIL (endpoint doesn't exist)

**Step 3: Write the implementation**

```typescript
// src/app/api/projects/[projectId]/drift/route.ts
/**
 * Drift Detection API
 * GET: Fetch drift timeline and summary
 * POST: Record a new drift event
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getDriftTimeline, getDriftSummary, detectDrift, resolveDrift } from '@/lib/quoth/drift';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30', 10);
  const includeResolved = searchParams.get('includeResolved') === 'true';

  // Verify authentication
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Not a project member' }, { status: 403 });
  }

  try {
    const [timeline, summary] = await Promise.all([
      getDriftTimeline(projectId, days, includeResolved),
      getDriftSummary(projectId),
    ]);

    return NextResponse.json({
      timeline,
      summary,
    });
  } catch (error) {
    console.error('[Drift API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch drift data' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  // Verify authentication
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify project membership with editor+ role
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!membership || !['admin', 'editor'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, ...data } = body;

    if (action === 'resolve') {
      const success = await resolveDrift(data.driftId, user.id, data.note);
      if (success) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'Failed to resolve drift' }, { status: 500 });
    }

    // Default: detect new drift
    const driftEvent = await detectDrift({
      projectId,
      ...data,
    });

    return NextResponse.json({ drift: driftEvent });
  } catch (error) {
    console.error('[Drift API] Error:', error);
    return NextResponse.json({ error: 'Failed to process drift event' }, { status: 500 });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run dev` then manually test endpoint
Expected: Endpoint responds with proper JSON structure

**Step 5: Commit**

```bash
git add src/app/api/projects/[projectId]/drift/route.ts
git commit -m "feat: add drift detection API endpoint"
```

---

## Task 4: Document Staleness Service

**Files:**
- Create: `src/lib/quoth/health.ts`
- Test: `src/lib/quoth/__tests__/health.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/quoth/__tests__/health.test.ts
import { describe, it, expect, vi } from 'vitest';
import { calculateStaleness, getDocumentHealth, StalenessLevel } from '../health';

describe('document health', () => {
  it('should classify recently updated docs as fresh', () => {
    const lastUpdated = new Date();
    lastUpdated.setDate(lastUpdated.getDate() - 5); // 5 days ago

    const result = calculateStaleness(lastUpdated);
    expect(result.level).toBe('fresh');
    expect(result.daysStale).toBe(5);
  });

  it('should classify 30+ day old docs as aging', () => {
    const lastUpdated = new Date();
    lastUpdated.setDate(lastUpdated.getDate() - 45); // 45 days ago

    const result = calculateStaleness(lastUpdated);
    expect(result.level).toBe('aging');
  });

  it('should classify 90+ day old docs as stale', () => {
    const lastUpdated = new Date();
    lastUpdated.setDate(lastUpdated.getDate() - 100); // 100 days ago

    const result = calculateStaleness(lastUpdated);
    expect(result.level).toBe('stale');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/quoth/__tests__/health.test.ts`
Expected: FAIL with "Cannot find module '../health'"

**Step 3: Write the implementation**

```typescript
// src/lib/quoth/health.ts
/**
 * Document Health Service
 * Calculates staleness indicators and health metrics
 */

import { supabase } from '../supabase';

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'critical';

export interface StalenessResult {
  level: StalenessLevel;
  daysStale: number;
  lastUpdated: Date;
  suggestedAction?: string;
}

export interface DocumentHealth {
  documentId: string;
  title: string;
  filePath: string;
  staleness: StalenessResult;
  lastReadCount: number;
  searchHitRate: number;
}

export interface ProjectHealthSummary {
  totalDocs: number;
  freshDocs: number;
  agingDocs: number;
  staleDocs: number;
  criticalDocs: number;
  overallScore: number; // 0-100
  documents: DocumentHealth[];
}

// Staleness thresholds (in days)
const THRESHOLDS = {
  fresh: 14,    // < 14 days = fresh
  aging: 30,    // 14-30 days = aging
  stale: 60,    // 30-60 days = stale
  critical: 90, // > 60 days = critical
};

/**
 * Calculate staleness level from last update date
 */
export function calculateStaleness(lastUpdated: Date | string): StalenessResult {
  const lastDate = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  const daysStale = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let level: StalenessLevel;
  let suggestedAction: string | undefined;

  if (daysStale < THRESHOLDS.fresh) {
    level = 'fresh';
  } else if (daysStale < THRESHOLDS.aging) {
    level = 'aging';
    suggestedAction = 'Review for accuracy';
  } else if (daysStale < THRESHOLDS.stale) {
    level = 'stale';
    suggestedAction = 'Update recommended';
  } else {
    level = 'critical';
    suggestedAction = 'Urgent update required';
  }

  return {
    level,
    daysStale,
    lastUpdated: lastDate,
    suggestedAction,
  };
}

/**
 * Get health metrics for a single document
 */
export async function getDocumentHealth(
  documentId: string,
  projectId: string
): Promise<DocumentHealth | null> {
  // Fetch document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, title, file_path, last_updated')
    .eq('id', documentId)
    .eq('project_id', projectId)
    .single();

  if (docError || !doc) {
    return null;
  }

  // Fetch activity stats for this document
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: activities } = await supabase
    .from('quoth_activity')
    .select('event_type, result_count')
    .eq('project_id', projectId)
    .eq('document_id', documentId)
    .gte('created_at', thirtyDaysAgo.toISOString());

  const readCount = activities?.filter((a) => a.event_type === 'read').length || 0;
  const searchHits = activities?.filter((a) =>
    a.event_type === 'search' && (a.result_count ?? 0) > 0
  ).length || 0;
  const totalSearches = activities?.filter((a) => a.event_type === 'search').length || 1;

  return {
    documentId: doc.id,
    title: doc.title,
    filePath: doc.file_path,
    staleness: calculateStaleness(doc.last_updated),
    lastReadCount: readCount,
    searchHitRate: Math.round((searchHits / totalSearches) * 100),
  };
}

/**
 * Get health summary for all documents in a project
 */
export async function getProjectHealth(projectId: string): Promise<ProjectHealthSummary> {
  // Fetch all documents
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, title, file_path, last_updated')
    .eq('project_id', projectId)
    .order('last_updated', { ascending: true });

  if (error || !docs) {
    return {
      totalDocs: 0,
      freshDocs: 0,
      agingDocs: 0,
      staleDocs: 0,
      criticalDocs: 0,
      overallScore: 0,
      documents: [],
    };
  }

  const documents: DocumentHealth[] = docs.map((doc) => {
    const staleness = calculateStaleness(doc.last_updated);
    return {
      documentId: doc.id,
      title: doc.title,
      filePath: doc.file_path,
      staleness,
      lastReadCount: 0, // Would need batch query for performance
      searchHitRate: 0,
    };
  });

  // Count by staleness level
  const counts = {
    fresh: documents.filter((d) => d.staleness.level === 'fresh').length,
    aging: documents.filter((d) => d.staleness.level === 'aging').length,
    stale: documents.filter((d) => d.staleness.level === 'stale').length,
    critical: documents.filter((d) => d.staleness.level === 'critical').length,
  };

  // Calculate overall health score (weighted)
  // Fresh = 100%, Aging = 70%, Stale = 30%, Critical = 0%
  const totalDocs = documents.length || 1;
  const overallScore = Math.round(
    ((counts.fresh * 100 + counts.aging * 70 + counts.stale * 30 + counts.critical * 0) / totalDocs)
  );

  return {
    totalDocs: documents.length,
    freshDocs: counts.fresh,
    agingDocs: counts.aging,
    staleDocs: counts.stale,
    criticalDocs: counts.critical,
    overallScore,
    documents: documents.sort((a, b) => {
      // Sort by staleness level (worst first)
      const order: Record<StalenessLevel, number> = { critical: 0, stale: 1, aging: 2, fresh: 3 };
      return order[a.staleness.level] - order[b.staleness.level];
    }),
  };
}

/**
 * Get documents that need attention (stale or critical)
 */
export async function getDocumentsNeedingAttention(
  projectId: string,
  limit: number = 10
): Promise<DocumentHealth[]> {
  const health = await getProjectHealth(projectId);
  return health.documents
    .filter((d) => d.staleness.level === 'stale' || d.staleness.level === 'critical')
    .slice(0, limit);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/quoth/__tests__/health.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/lib/quoth/health.ts src/lib/quoth/__tests__/health.test.ts
git commit -m "feat: add document health service with staleness indicators"
```

---

## Task 5: Health API Endpoint

**Files:**
- Create: `src/app/api/projects/[projectId]/health/route.ts`

**Step 1: Write the API endpoint**

```typescript
// src/app/api/projects/[projectId]/health/route.ts
/**
 * Document Health API
 * GET: Fetch project health summary and staleness indicators
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getProjectHealth, getDocumentsNeedingAttention } from '@/lib/quoth/health';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const needingAttentionOnly = searchParams.get('needingAttention') === 'true';
  const limit = parseInt(searchParams.get('limit') || '10', 10);

  // Verify authentication
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Not a project member' }, { status: 403 });
  }

  try {
    if (needingAttentionOnly) {
      const documents = await getDocumentsNeedingAttention(projectId, limit);
      return NextResponse.json({ documents });
    }

    const health = await getProjectHealth(projectId);
    return NextResponse.json({ health });
  } catch (error) {
    console.error('[Health API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 });
  }
}
```

**Step 2: Verify endpoint works**

Run: `npm run dev` then test with curl or browser
Expected: JSON response with health metrics

**Step 3: Commit**

```bash
git add src/app/api/projects/[projectId]/health/route.ts
git commit -m "feat: add project health API endpoint"
```

---

## Task 6: Enhanced Miss Rate Analytics

**Files:**
- Modify: `src/lib/quoth/activity.ts`
- Modify: `src/app/api/analytics/usage/route.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/quoth/__tests__/activity.test.ts (add to existing)
describe('miss rate analytics', () => {
  it('should return miss rate trends over time', async () => {
    const result = await getMissRateTrends('test-project', 7);
    expect(result).toHaveProperty('dailyMissRates');
    expect(result).toHaveProperty('averageMissRate');
    expect(result).toHaveProperty('trend'); // 'improving', 'stable', 'degrading'
  });

  it('should identify top missed queries', async () => {
    const result = await getTopMissedQueries('test-project', 10);
    expect(Array.isArray(result)).toBe(true);
    result.forEach((item) => {
      expect(item).toHaveProperty('query');
      expect(item).toHaveProperty('missCount');
      expect(item).toHaveProperty('lastMissed');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/quoth/__tests__/activity.test.ts`
Expected: FAIL with "getMissRateTrends is not defined"

**Step 3: Add miss rate analytics functions to activity.ts**

```typescript
// Add to src/lib/quoth/activity.ts

/**
 * Get miss rate trends over time
 */
export async function getMissRateTrends(
  projectId: string,
  days: number = 7
): Promise<{
  dailyMissRates: Array<{ date: string; missRate: number; searchCount: number }>;
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: activities, error } = await supabase
    .from('quoth_activity')
    .select('event_type, result_count, created_at')
    .eq('project_id', projectId)
    .eq('event_type', 'search')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error || !activities) {
    return {
      dailyMissRates: [],
      averageMissRate: 0,
      trend: 'stable',
    };
  }

  // Group by date
  const byDate = new Map<string, { searches: number; misses: number }>();

  activities.forEach((a) => {
    const date = new Date(a.created_at).toISOString().split('T')[0];
    const current = byDate.get(date) || { searches: 0, misses: 0 };
    current.searches++;
    if ((a.result_count ?? 0) === 0) {
      current.misses++;
    }
    byDate.set(date, current);
  });

  const dailyMissRates = Array.from(byDate.entries()).map(([date, stats]) => ({
    date,
    missRate: stats.searches > 0 ? Math.round((stats.misses / stats.searches) * 100) : 0,
    searchCount: stats.searches,
  }));

  // Calculate average
  const totalMisses = activities.filter((a) => (a.result_count ?? 0) === 0).length;
  const averageMissRate = activities.length > 0
    ? Math.round((totalMisses / activities.length) * 100)
    : 0;

  // Determine trend (compare first half vs second half)
  const mid = Math.floor(dailyMissRates.length / 2);
  const firstHalf = dailyMissRates.slice(0, mid);
  const secondHalf = dailyMissRates.slice(mid);

  const avgFirst = firstHalf.length > 0
    ? firstHalf.reduce((sum, d) => sum + d.missRate, 0) / firstHalf.length
    : 0;
  const avgSecond = secondHalf.length > 0
    ? secondHalf.reduce((sum, d) => sum + d.missRate, 0) / secondHalf.length
    : 0;

  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (avgSecond < avgFirst - 5) trend = 'improving';
  else if (avgSecond > avgFirst + 5) trend = 'degrading';

  return {
    dailyMissRates,
    averageMissRate,
    trend,
  };
}

/**
 * Get queries that resulted in zero results (gaps in documentation)
 */
export async function getTopMissedQueries(
  projectId: string,
  limit: number = 10
): Promise<Array<{ query: string; missCount: number; lastMissed: string }>> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: activities, error } = await supabase
    .from('quoth_activity')
    .select('query, created_at')
    .eq('project_id', projectId)
    .eq('event_type', 'search')
    .eq('result_count', 0)
    .gte('created_at', thirtyDaysAgo.toISOString());

  if (error || !activities) {
    return [];
  }

  // Count misses per query
  const queryMisses = new Map<string, { count: number; lastMissed: string }>();

  activities.forEach((a) => {
    if (a.query) {
      const normalized = a.query.toLowerCase().trim();
      const existing = queryMisses.get(normalized);
      if (!existing || new Date(a.created_at) > new Date(existing.lastMissed)) {
        queryMisses.set(normalized, {
          count: (existing?.count || 0) + 1,
          lastMissed: a.created_at,
        });
      } else {
        existing.count++;
      }
    }
  });

  return Array.from(queryMisses.entries())
    .map(([query, stats]) => ({
      query,
      missCount: stats.count,
      lastMissed: stats.lastMissed,
    }))
    .sort((a, b) => b.missCount - a.missCount)
    .slice(0, limit);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/quoth/__tests__/activity.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/quoth/activity.ts src/lib/quoth/__tests__/activity.test.ts
git commit -m "feat: add miss rate trends and top missed queries analytics"
```

---

## Task 7: Weekly Health Report Email Template

**Files:**
- Create: `src/emails/WeeklyHealthReportEmail.tsx`

**Step 1: Create the email template**

```typescript
// src/emails/WeeklyHealthReportEmail.tsx
/**
 * Weekly Health Report Email Template
 * Sends documentation health summary to team members
 */

import { Text, Section, Hr, Link } from '@react-email/components';
import * as React from 'react';
import {
  QuothEmailLayout,
  QuothButton,
  emailStyles,
} from './QuothEmailLayout';

const { colors, heading, paragraph, smallText, divider } = emailStyles;

interface HealthMetrics {
  overallScore: number;
  totalDocs: number;
  freshDocs: number;
  agingDocs: number;
  staleDocs: number;
  criticalDocs: number;
}

interface DriftSummary {
  total: number;
  critical: number;
  warning: number;
  unresolvedCount: number;
}

interface MissRateMetrics {
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
  topMissedQueries: Array<{ query: string; missCount: number }>;
}

interface WeeklyHealthReportEmailProps {
  projectName: string;
  projectSlug: string;
  periodStart: string;
  periodEnd: string;
  health: HealthMetrics;
  drift: DriftSummary;
  missRate: MissRateMetrics;
  dashboardUrl: string;
}

export function WeeklyHealthReportEmail({
  projectName,
  projectSlug,
  periodStart,
  periodEnd,
  health,
  drift,
  missRate,
  dashboardUrl,
}: WeeklyHealthReportEmailProps) {
  const scoreColor = health.overallScore >= 80
    ? colors.violetGhost
    : health.overallScore >= 50
      ? '#FCD34D'
      : '#F87171';

  const trendEmoji = missRate.trend === 'improving'
    ? '📈'
    : missRate.trend === 'degrading'
      ? '📉'
      : '➡️';

  return (
    <QuothEmailLayout preview={`Weekly Health Report for ${projectName}`}>
      {/* Header */}
      <Text style={heading}>
        Weekly Documentation Health Report
      </Text>
      <Text style={{ ...paragraph, textAlign: 'center' as const }}>
        <span style={{ color: colors.violetGhost }}>{projectName}</span>
        <br />
        <span style={smallText}>{periodStart} — {periodEnd}</span>
      </Text>

      <Hr style={divider} />

      {/* Health Score */}
      <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
        <Text style={{ ...paragraph, fontSize: '14px', marginBottom: '8px' }}>
          Documentation Health Score
        </Text>
        <Text style={{
          fontSize: '48px',
          fontWeight: 'bold',
          color: scoreColor,
          margin: '0',
        }}>
          {health.overallScore}%
        </Text>
        <Text style={{ ...smallText, marginTop: '8px' }}>
          {health.freshDocs} fresh · {health.agingDocs} aging · {health.staleDocs} stale · {health.criticalDocs} critical
        </Text>
      </Section>

      <Hr style={divider} />

      {/* Drift Summary */}
      <Text style={{ ...paragraph, fontWeight: 600, marginBottom: '12px' }}>
        ⚠️ Drift Detection
      </Text>
      <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '16px' }}>
        <tr>
          <td style={metricCell}>
            <Text style={metricValue}>{drift.unresolvedCount}</Text>
            <Text style={metricLabel}>Unresolved</Text>
          </td>
          <td style={metricCell}>
            <Text style={{ ...metricValue, color: '#F87171' }}>{drift.critical}</Text>
            <Text style={metricLabel}>Critical</Text>
          </td>
          <td style={metricCell}>
            <Text style={{ ...metricValue, color: '#FCD34D' }}>{drift.warning}</Text>
            <Text style={metricLabel}>Warnings</Text>
          </td>
        </tr>
      </table>

      <Hr style={divider} />

      {/* Miss Rate */}
      <Text style={{ ...paragraph, fontWeight: 600, marginBottom: '12px' }}>
        🔍 Search Miss Rate {trendEmoji}
      </Text>
      <Text style={paragraph}>
        <strong style={{ color: colors.violetGhost }}>{missRate.averageMissRate}%</strong> of searches returned no results
        <br />
        <span style={smallText}>
          Trend: {missRate.trend === 'improving' ? 'Improving' : missRate.trend === 'degrading' ? 'Needs attention' : 'Stable'}
        </span>
      </Text>

      {missRate.topMissedQueries.length > 0 && (
        <>
          <Text style={{ ...smallText, marginTop: '16px', marginBottom: '8px' }}>
            Top missed queries (consider documenting):
          </Text>
          <ul style={{ margin: '0', paddingLeft: '20px' }}>
            {missRate.topMissedQueries.slice(0, 5).map((q, i) => (
              <li key={i} style={{ ...smallText, marginBottom: '4px' }}>
                "{q.query}" ({q.missCount}x)
              </li>
            ))}
          </ul>
        </>
      )}

      <Hr style={divider} />

      {/* CTA */}
      <QuothButton href={dashboardUrl}>
        View Full Report
      </QuothButton>

      <Text style={{ ...smallText, textAlign: 'center' as const, marginTop: '16px' }}>
        This report is sent weekly to project admins.
        <br />
        <Link
          href={`${dashboardUrl}/settings`}
          style={{ color: colors.violetGhost }}
        >
          Manage notification preferences
        </Link>
      </Text>
    </QuothEmailLayout>
  );
}

// Helper styles
const metricCell: React.CSSProperties = {
  textAlign: 'center',
  padding: '8px',
};

const metricValue: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: colors.text,
  margin: '0',
};

const metricLabel: React.CSSProperties = {
  fontSize: '12px',
  color: colors.textMuted,
  margin: '4px 0 0 0',
};

export default WeeklyHealthReportEmail;
```

**Step 2: Verify email renders correctly**

Run: `npm run email:dev` (if configured) or check React Email preview
Expected: Email renders with all sections visible

**Step 3: Commit**

```bash
git add src/emails/WeeklyHealthReportEmail.tsx
git commit -m "feat: add weekly health report email template"
```

---

## Task 8: Weekly Report Cron Endpoint

**Files:**
- Create: `src/app/api/cron/weekly-health-report/route.ts`
- Modify: `src/lib/email.ts`

**Step 1: Add email sending function**

```typescript
// Add to src/lib/email.ts

import { render } from '@react-email/render';
import { WeeklyHealthReportEmail } from '@/emails/WeeklyHealthReportEmail';

export interface WeeklyReportParams {
  projectName: string;
  projectSlug: string;
  periodStart: string;
  periodEnd: string;
  health: {
    overallScore: number;
    totalDocs: number;
    freshDocs: number;
    agingDocs: number;
    staleDocs: number;
    criticalDocs: number;
  };
  drift: {
    total: number;
    critical: number;
    warning: number;
    unresolvedCount: number;
  };
  missRate: {
    averageMissRate: number;
    trend: 'improving' | 'stable' | 'degrading';
    topMissedQueries: Array<{ query: string; missCount: number }>;
  };
  recipients: string[];
}

/**
 * Send weekly health report to project team
 */
export async function sendWeeklyHealthReport(params: WeeklyReportParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] Resend not configured. Skipping weekly report.');
    return;
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';
  const dashboardUrl = `${APP_URL}/dashboard/${params.projectSlug}`;

  try {
    const html = await render(
      WeeklyHealthReportEmail({
        projectName: params.projectName,
        projectSlug: params.projectSlug,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        health: params.health,
        drift: params.drift,
        missRate: params.missRate,
        dashboardUrl,
      })
    );

    // Send to each recipient
    for (const email of params.recipients) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `[Quoth] Weekly Health Report: ${params.projectName}`,
        html,
      });
    }

    console.log(`[Email] Weekly report sent to ${params.recipients.length} recipients`);
  } catch (error) {
    console.error('[Email] Failed to send weekly report:', error);
  }
}
```

**Step 2: Create the cron endpoint**

```typescript
// src/app/api/cron/weekly-health-report/route.ts
/**
 * Weekly Health Report Cron Job
 * Sends documentation health reports to project admins
 *
 * Schedule: Every Monday at 9:00 AM UTC
 * Vercel Cron: Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/weekly-health-report",
 *     "schedule": "0 9 * * 1"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getProjectHealth } from '@/lib/quoth/health';
import { getDriftSummary } from '@/lib/quoth/drift';
import { getMissRateTrends, getTopMissedQueries } from '@/lib/quoth/activity';
import { sendWeeklyHealthReport } from '@/lib/email';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all projects with email notifications enabled
    // For now, get all projects and their admin members
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select(`
        id,
        slug,
        github_repo,
        project_members!inner(
          user_id,
          role,
          profiles(email)
        )
      `)
      .eq('project_members.role', 'admin');

    if (projectsError || !projects) {
      console.error('[Cron] Failed to fetch projects:', projectsError);
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }

    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const periodStart = weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const periodEnd = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    let sentCount = 0;

    for (const project of projects) {
      // Get project metrics
      const [health, drift, missRateTrends, topMissed] = await Promise.all([
        getProjectHealth(project.id),
        getDriftSummary(project.id),
        getMissRateTrends(project.id, 7),
        getTopMissedQueries(project.id, 5),
      ]);

      // Extract admin emails
      const adminEmails = project.project_members
        .map((pm: any) => pm.profiles?.email)
        .filter(Boolean);

      if (adminEmails.length === 0) continue;

      // Derive project name from slug or repo
      const projectName = project.github_repo?.split('/').pop() || project.slug;

      await sendWeeklyHealthReport({
        projectName,
        projectSlug: project.slug,
        periodStart,
        periodEnd,
        health: {
          overallScore: health.overallScore,
          totalDocs: health.totalDocs,
          freshDocs: health.freshDocs,
          agingDocs: health.agingDocs,
          staleDocs: health.staleDocs,
          criticalDocs: health.criticalDocs,
        },
        drift,
        missRate: {
          averageMissRate: missRateTrends.averageMissRate,
          trend: missRateTrends.trend,
          topMissedQueries: topMissed,
        },
        recipients: adminEmails,
      });

      sentCount++;
    }

    return NextResponse.json({
      success: true,
      projectsProcessed: projects.length,
      reportsSent: sentCount,
    });
  } catch (error) {
    console.error('[Cron] Weekly report error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Add Vercel cron configuration**

```json
// vercel.json (create or modify)
{
  "crons": [
    {
      "path": "/api/cron/weekly-health-report",
      "schedule": "0 9 * * 1"
    }
  ]
}
```

**Step 4: Commit**

```bash
git add src/app/api/cron/weekly-health-report/route.ts src/lib/email.ts vercel.json
git commit -m "feat: add weekly health report cron job"
```

---

## Task 9: Drift Timeline Dashboard Component

**Files:**
- Create: `src/components/dashboard/DriftTimeline.tsx`

**Step 1: Create the component**

```typescript
// src/components/dashboard/DriftTimeline.tsx
'use client';

/**
 * Drift Timeline Component
 * Visualizes documentation drift events over time
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, Check, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface DriftEvent {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  driftType: string;
  filePath: string;
  docPath?: string;
  description: string;
  expectedPattern?: string;
  actualCode?: string;
  resolved: boolean;
  detectedAt: string;
}

interface DriftSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unresolvedCount: number;
}

interface DriftTimelineProps {
  projectId: string;
}

export function DriftTimeline({ projectId }: DriftTimelineProps) {
  const [timeline, setTimeline] = useState<DriftEvent[]>([]);
  const [summary, setSummary] = useState<DriftSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    async function fetchDrift() {
      try {
        const url = `/api/projects/${projectId}/drift?days=30&includeResolved=${showResolved}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch drift data');
        const data = await res.json();
        setTimeline(data.timeline);
        setSummary(data.summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchDrift();
  }, [projectId, showResolved]);

  const handleResolve = async (driftId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/drift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', driftId }),
      });

      if (res.ok) {
        setTimeline((prev) =>
          prev.map((d) => (d.id === driftId ? { ...d, resolved: true } : d))
        );
      }
    } catch (err) {
      console.error('Failed to resolve drift:', err);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      default:
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/10 border-red-500/20';
      case 'warning':
        return 'bg-amber-500/10 border-amber-500/20';
      default:
        return 'bg-blue-500/10 border-blue-500/20';
    }
  };

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="h-40 bg-charcoal rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/15">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Drift Detection</h3>
            <p className="text-sm text-gray-500">Last 30 days</p>
          </div>
        </div>

        {/* Toggle resolved */}
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-gray-600 bg-charcoal"
          />
          Show resolved
        </label>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="text-center p-3 rounded-lg bg-charcoal/50">
            <p className="text-xl font-bold text-white">{summary.unresolvedCount}</p>
            <p className="text-xs text-gray-500">Unresolved</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-500/10">
            <p className="text-xl font-bold text-red-400">{summary.critical}</p>
            <p className="text-xs text-gray-500">Critical</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-amber-500/10">
            <p className="text-xl font-bold text-amber-400">{summary.warning}</p>
            <p className="text-xs text-gray-500">Warning</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-blue-500/10">
            <p className="text-xl font-bold text-blue-400">{summary.info}</p>
            <p className="text-xs text-gray-500">Info</p>
          </div>
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 ? (
        <div className="space-y-3">
          {timeline.map((drift) => (
            <div
              key={drift.id}
              className={`border rounded-lg ${getSeverityBg(drift.severity)} ${
                drift.resolved ? 'opacity-60' : ''
              }`}
            >
              {/* Main row */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === drift.id ? null : drift.id)}
              >
                {getSeverityIcon(drift.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{drift.description}</p>
                  <p className="text-xs text-gray-500 truncate">
                    <code>{drift.filePath}</code>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {drift.resolved && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Resolved
                    </span>
                  )}
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(drift.detectedAt).toLocaleDateString()}
                  </span>
                  {expandedId === drift.id ? (
                    <ChevronUp className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedId === drift.id && (
                <div className="px-4 pb-4 border-t border-gray-700/50">
                  <div className="mt-3 space-y-3">
                    {drift.expectedPattern && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Expected:</p>
                        <code className="text-xs text-emerald-400 bg-charcoal px-2 py-1 rounded block">
                          {drift.expectedPattern}
                        </code>
                      </div>
                    )}
                    {drift.actualCode && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Actual:</p>
                        <code className="text-xs text-red-400 bg-charcoal px-2 py-1 rounded block">
                          {drift.actualCode}
                        </code>
                      </div>
                    )}
                    {!drift.resolved && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResolve(drift.id);
                        }}
                        className="text-sm text-violet-spectral hover:text-violet-glow transition-colors"
                      >
                        Mark as resolved
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <AlertTriangle className="w-8 h-8 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No drift events detected</p>
          <p className="text-sm text-gray-500">
            Your documentation is in sync with your code
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify component renders**

Run: `npm run dev` and check dashboard
Expected: Component displays drift timeline

**Step 3: Commit**

```bash
git add src/components/dashboard/DriftTimeline.tsx
git commit -m "feat: add drift timeline dashboard component"
```

---

## Task 10: Health Dashboard Component

**Files:**
- Create: `src/components/dashboard/HealthDashboard.tsx`

**Step 1: Create the component**

```typescript
// src/components/dashboard/HealthDashboard.tsx
'use client';

/**
 * Health Dashboard Component
 * Displays document staleness and health metrics
 */

import { useState, useEffect } from 'react';
import { Heart, FileText, AlertTriangle, Clock, RefreshCw } from 'lucide-react';

interface DocumentHealth {
  documentId: string;
  title: string;
  filePath: string;
  staleness: {
    level: 'fresh' | 'aging' | 'stale' | 'critical';
    daysStale: number;
    suggestedAction?: string;
  };
}

interface ProjectHealth {
  totalDocs: number;
  freshDocs: number;
  agingDocs: number;
  staleDocs: number;
  criticalDocs: number;
  overallScore: number;
  documents: DocumentHealth[];
}

interface HealthDashboardProps {
  projectId: string;
}

export function HealthDashboard({ projectId }: HealthDashboardProps) {
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch(`/api/projects/${projectId}/health`);
        if (!res.ok) throw new Error('Failed to fetch health data');
        const data = await res.json();
        setHealth(data.health);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchHealth();
  }, [projectId]);

  const getStalenessColor = (level: string) => {
    switch (level) {
      case 'fresh':
        return 'text-emerald-400';
      case 'aging':
        return 'text-blue-400';
      case 'stale':
        return 'text-amber-400';
      case 'critical':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStalenessIcon = (level: string) => {
    switch (level) {
      case 'fresh':
        return <Heart className="w-4 h-4 text-emerald-400" />;
      case 'aging':
        return <Clock className="w-4 h-4 text-blue-400" />;
      case 'stale':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'critical':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      default:
        return <FileText className="w-4 h-4 text-gray-400" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 50) return 'text-amber-400';
    return 'text-red-400';
  };

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="h-32 bg-charcoal rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-gray-400">No health data available</p>
      </div>
    );
  }

  const needsAttention = health.documents.filter(
    (d) => d.staleness.level === 'stale' || d.staleness.level === 'critical'
  );

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/15">
            <Heart className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Documentation Health</h3>
            <p className="text-sm text-gray-500">{health.totalDocs} documents</p>
          </div>
        </div>

        {/* Health Score */}
        <div className="text-right">
          <p className={`text-3xl font-bold ${getScoreColor(health.overallScore)}`}>
            {health.overallScore}%
          </p>
          <p className="text-xs text-gray-500">Health Score</p>
        </div>
      </div>

      {/* Staleness Distribution */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="text-center p-3 rounded-lg bg-emerald-500/10">
          <p className="text-xl font-bold text-emerald-400">{health.freshDocs}</p>
          <p className="text-xs text-gray-500">Fresh</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-blue-500/10">
          <p className="text-xl font-bold text-blue-400">{health.agingDocs}</p>
          <p className="text-xs text-gray-500">Aging</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-amber-500/10">
          <p className="text-xl font-bold text-amber-400">{health.staleDocs}</p>
          <p className="text-xs text-gray-500">Stale</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-red-500/10">
          <p className="text-xl font-bold text-red-400">{health.criticalDocs}</p>
          <p className="text-xs text-gray-500">Critical</p>
        </div>
      </div>

      {/* Staleness Legend */}
      <div className="flex gap-4 text-xs text-gray-500 mb-6 justify-center">
        <span>Fresh: &lt;14d</span>
        <span>Aging: 14-30d</span>
        <span>Stale: 30-60d</span>
        <span>Critical: &gt;60d</span>
      </div>

      {/* Documents Needing Attention */}
      {needsAttention.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">Documents needing attention</span>
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-violet-spectral hover:text-violet-glow"
            >
              {showAll ? 'Show less' : `Show all (${needsAttention.length})`}
            </button>
          </div>

          <div className="space-y-2">
            {(showAll ? needsAttention : needsAttention.slice(0, 5)).map((doc) => (
              <div
                key={doc.documentId}
                className="flex items-center justify-between p-3 rounded-lg bg-charcoal/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {getStalenessIcon(doc.staleness.level)}
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{doc.title}</p>
                    <p className="text-xs text-gray-500 truncate">
                      <code>{doc.filePath}</code>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className={`text-sm ${getStalenessColor(doc.staleness.level)}`}>
                    {doc.staleness.daysStale}d ago
                  </p>
                  {doc.staleness.suggestedAction && (
                    <p className="text-xs text-gray-500">{doc.staleness.suggestedAction}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {needsAttention.length === 0 && (
        <div className="text-center py-6">
          <Heart className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <p className="text-gray-400">All documents are healthy!</p>
          <p className="text-sm text-gray-500">
            Your documentation is up to date
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify component renders**

Run: `npm run dev` and check dashboard
Expected: Component displays health metrics

**Step 3: Commit**

```bash
git add src/components/dashboard/HealthDashboard.tsx
git commit -m "feat: add health dashboard component with staleness indicators"
```

---

## Task 11: Miss Rate Chart Component

**Files:**
- Create: `src/components/dashboard/MissRateChart.tsx`

**Step 1: Create the component**

```typescript
// src/components/dashboard/MissRateChart.tsx
'use client';

/**
 * Miss Rate Chart Component
 * Visualizes search miss rate trends over time
 */

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Search, HelpCircle } from 'lucide-react';

interface MissRateTrends {
  dailyMissRates: Array<{ date: string; missRate: number; searchCount: number }>;
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface TopMissedQuery {
  query: string;
  missCount: number;
  lastMissed: string;
}

interface MissRateChartProps {
  projectId: string;
}

export function MissRateChart({ projectId }: MissRateChartProps) {
  const [trends, setTrends] = useState<MissRateTrends | null>(null);
  const [topMissed, setTopMissed] = useState<TopMissedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/analytics/miss-rate?project_id=${projectId}&period=7d`);
        if (!res.ok) throw new Error('Failed to fetch miss rate data');
        const data = await res.json();
        setTrends(data.trends);
        setTopMissed(data.topMissed || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  const getTrendIcon = () => {
    if (!trends) return null;
    switch (trends.trend) {
      case 'improving':
        return <TrendingDown className="w-5 h-5 text-emerald-400" />;
      case 'degrading':
        return <TrendingUp className="w-5 h-5 text-red-400" />;
      default:
        return <Minus className="w-5 h-5 text-gray-400" />;
    }
  };

  const getTrendText = () => {
    if (!trends) return '';
    switch (trends.trend) {
      case 'improving':
        return 'Improving';
      case 'degrading':
        return 'Needs attention';
      default:
        return 'Stable';
    }
  };

  const getTrendColor = () => {
    if (!trends) return 'text-gray-400';
    switch (trends.trend) {
      case 'improving':
        return 'text-emerald-400';
      case 'degrading':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const maxRate = trends
    ? Math.max(...trends.dailyMissRates.map((d) => d.missRate), 10)
    : 100;

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-6 animate-pulse">
        <div className="h-6 bg-charcoal rounded w-1/3 mb-4" />
        <div className="h-32 bg-charcoal rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-spectral/15">
            <Search className="w-5 h-5 text-violet-spectral" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Search Miss Rate</h3>
            <p className="text-sm text-gray-500">Last 7 days</p>
          </div>
        </div>

        {/* Trend Indicator */}
        {trends && (
          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <span className={`text-sm ${getTrendColor()}`}>{getTrendText()}</span>
          </div>
        )}
      </div>

      {trends && trends.dailyMissRates.length > 0 ? (
        <>
          {/* Average Rate */}
          <div className="text-center mb-6">
            <p className={`text-4xl font-bold ${
              trends.averageMissRate > 30 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {trends.averageMissRate}%
            </p>
            <p className="text-sm text-gray-500">Average miss rate</p>
          </div>

          {/* Simple Bar Chart */}
          <div className="mb-6">
            <div className="flex items-end justify-between gap-1 h-24">
              {trends.dailyMissRates.map((day, index) => {
                const height = (day.missRate / maxRate) * 100;
                const isHigh = day.missRate > 30;
                return (
                  <div
                    key={index}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <div
                      className={`w-full rounded-t transition-all ${
                        isHigh ? 'bg-amber-400' : 'bg-violet-spectral'
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${day.date}: ${day.missRate}% (${day.searchCount} searches)`}
                    />
                    <span className="text-[10px] text-gray-500">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Missed Queries */}
          {topMissed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-400">
                  Top queries with no results
                </span>
              </div>
              <div className="space-y-2">
                {topMissed.slice(0, 5).map((query, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm p-2 rounded bg-charcoal/50"
                  >
                    <span className="text-gray-300 truncate max-w-[200px]">
                      "{query.query}"
                    </span>
                    <span className="text-amber-400 shrink-0 ml-2">
                      {query.missCount}x missed
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Consider documenting these topics to reduce miss rate
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Search className="w-8 h-8 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-400">No search data yet</p>
          <p className="text-sm text-gray-500">
            Start using Quoth search to see analytics
          </p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Create the miss rate API endpoint**

```typescript
// src/app/api/analytics/miss-rate/route.ts
/**
 * Miss Rate Analytics API
 * GET: Fetch miss rate trends and top missed queries
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMissRateTrends, getTopMissedQueries } from '@/lib/quoth/activity';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const period = searchParams.get('period') || '7d';

  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 });
  }

  // Verify authentication
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Not a project member' }, { status: 403 });
  }

  try {
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;

    const [trends, topMissed] = await Promise.all([
      getMissRateTrends(projectId, days),
      getTopMissedQueries(projectId, 10),
    ]);

    return NextResponse.json({
      trends,
      topMissed,
    });
  } catch (error) {
    console.error('[Miss Rate API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch miss rate data' }, { status: 500 });
  }
}
```

**Step 3: Commit**

```bash
git add src/components/dashboard/MissRateChart.tsx src/app/api/analytics/miss-rate/route.ts
git commit -m "feat: add miss rate chart component and API endpoint"
```

---

## Task 12: Integrate Components into Analytics Dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/[projectSlug]/analytics/page.tsx`

**Step 1: Update the analytics page**

```typescript
// src/app/(app)/dashboard/[projectSlug]/analytics/page.tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase-server';
import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { CoverageCard } from '@/components/dashboard/CoverageCard';
import { DriftTimeline } from '@/components/dashboard/DriftTimeline';
import { HealthDashboard } from '@/components/dashboard/HealthDashboard';
import { MissRateChart } from '@/components/dashboard/MissRateChart';

interface PageProps {
  params: Promise<{ projectSlug: string }>;
}

export default async function AnalyticsPage({ params }: PageProps) {
  const { projectSlug } = await params;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  // Get project by slug
  const { data: project } = await supabase
    .from('projects')
    .select('id, slug, github_repo')
    .eq('slug', projectSlug)
    .single();

  if (!project) {
    redirect('/dashboard');
  }

  // Verify membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', project.id)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-obsidian">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Analytics & Insights</h1>
          <p className="text-gray-400 mt-1">
            Documentation health for {project.github_repo || project.slug}
          </p>
        </div>

        {/* Top Row: Coverage + Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <CoverageCard projectId={project.id} />
          <HealthDashboard projectId={project.id} />
        </div>

        {/* Middle Row: Activity + Miss Rate */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ActivityCard projectId={project.id} />
          <MissRateChart projectId={project.id} />
        </div>

        {/* Bottom Row: Drift Timeline (full width) */}
        <div className="mb-6">
          <DriftTimeline projectId={project.id} />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify all components display correctly**

Run: `npm run dev` and navigate to `/dashboard/[projectSlug]/analytics`
Expected: All 5 components render in a responsive grid layout

**Step 3: Commit**

```bash
git add src/app/(app)/dashboard/[projectSlug]/analytics/page.tsx
git commit -m "feat: integrate Phase 3 insight components into analytics dashboard"
```

---

## Task 13: Export All Services

**Files:**
- Modify: `src/lib/quoth/index.ts` (create if doesn't exist)

**Step 1: Create or update the index file**

```typescript
// src/lib/quoth/index.ts
/**
 * Quoth Services Export
 * Central export for all Quoth functionality
 */

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

// Search
export { searchDocuments } from './search';

// Tools
export { quothTools } from './tools';
```

**Step 2: Commit**

```bash
git add src/lib/quoth/index.ts
git commit -m "feat: create central export for all Quoth services"
```

---

## Task 14: Final Integration Test

**Files:**
- Create: `src/lib/quoth/__tests__/integration.test.ts`

**Step 1: Write integration test**

```typescript
// src/lib/quoth/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Phase 3 Integration', () => {
  it('should export all drift functions', async () => {
    const drift = await import('../drift');
    expect(drift.detectDrift).toBeDefined();
    expect(drift.getDriftTimeline).toBeDefined();
    expect(drift.getDriftSummary).toBeDefined();
    expect(drift.resolveDrift).toBeDefined();
  });

  it('should export all health functions', async () => {
    const health = await import('../health');
    expect(health.calculateStaleness).toBeDefined();
    expect(health.getDocumentHealth).toBeDefined();
    expect(health.getProjectHealth).toBeDefined();
    expect(health.getDocumentsNeedingAttention).toBeDefined();
  });

  it('should export all activity functions', async () => {
    const activity = await import('../activity');
    expect(activity.logActivity).toBeDefined();
    expect(activity.getActivitySummary).toBeDefined();
    expect(activity.getMissRateTrends).toBeDefined();
    expect(activity.getTopMissedQueries).toBeDefined();
  });

  it('should have consistent type exports', async () => {
    const index = await import('../index');

    // Verify type exports compile correctly
    const driftEvent: import('../drift').DriftEvent = {
      projectId: 'test',
      severity: 'warning',
      driftType: 'missing_doc',
      filePath: '/test.ts',
      description: 'Test',
      resolved: false,
    };

    const staleness: import('../health').StalenessResult = {
      level: 'fresh',
      daysStale: 5,
      lastUpdated: new Date(),
    };

    expect(driftEvent.severity).toBe('warning');
    expect(staleness.level).toBe('fresh');
  });
});
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Final commit**

```bash
git add src/lib/quoth/__tests__/integration.test.ts
git commit -m "test: add Phase 3 integration tests"
```

---

## Summary

Phase 3 implementation complete! The following features have been added:

### Database
- `drift_events` table for tracking documentation drift

### Services
- `src/lib/quoth/drift.ts` - Drift detection with severity classification
- `src/lib/quoth/health.ts` - Document staleness calculation
- `src/lib/quoth/activity.ts` - Enhanced with miss rate trends

### API Endpoints
- `GET/POST /api/projects/[projectId]/drift` - Drift timeline and management
- `GET /api/projects/[projectId]/health` - Project health metrics
- `GET /api/analytics/miss-rate` - Miss rate trends and top missed queries
- `GET /api/cron/weekly-health-report` - Weekly email reports

### Dashboard Components
- `DriftTimeline` - Timeline visualization of drift events
- `HealthDashboard` - Staleness indicators and health score
- `MissRateChart` - Search miss rate trends with bar chart

### Emails
- `WeeklyHealthReportEmail` - Branded health report template
- `sendWeeklyHealthReport()` - Email sending function

### Vercel Cron
- Weekly health report scheduled for Monday 9:00 AM UTC

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-01-23-phase3-insights-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
