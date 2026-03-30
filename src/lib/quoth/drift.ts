/**
 * Drift Detection Service
 * Detects and tracks documentation drift events
 */

import { supabase } from '../supabase';

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
        if (days > 90) return 'critical';
        if (days > 60) return 'warning';
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

  return data.map((row: any) => ({
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
    critical: data.filter((d: any) => d.severity === 'critical').length,
    warning: data.filter((d: any) => d.severity === 'warning').length,
    info: data.filter((d: any) => d.severity === 'info').length,
    unresolvedCount: data.filter((d: any) => !d.resolved).length,
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
