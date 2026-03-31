/**
 * GET /api/projects/:projectId/health
 *
 * Returns documentation health metrics with staleness indicators.
 * Used by the HealthDashboard component.
 *
 * Staleness levels: fresh (<14d), aging (14-30d), stale (30-60d), critical (>60d)
 */

import { sql } from 'drizzle-orm';
import { createApiHandler } from '@/lib/api/handler';

type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'critical';

function classifyStaleness(daysStale: number): { level: StalenessLevel; suggestedAction?: string } {
  if (daysStale < 14) return { level: 'fresh' };
  if (daysStale < 30) return { level: 'aging', suggestedAction: 'Review for accuracy' };
  if (daysStale < 60) return { level: 'stale', suggestedAction: 'Update or re-verify content' };
  return { level: 'critical', suggestedAction: 'Immediate review required — likely outdated' };
}

export const GET = createApiHandler(
  { auth: 'required', rateLimit: { rpm: 30 } },
  async (_req, ctx, params) => {
    const projectId = params.projectId;
    if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { getSecureDb } = await import('@/db/connection');
    const db = await getSecureDb(ctx.orgId, ctx.userId);

    // Fetch documents with staleness calculation
    const docsResult = await db.execute<{
      id: string;
      title: string;
      file_path: string;
      updated_at: string;
      days_stale: number;
    }>(sql`
      SELECT
        d.id,
        d.title,
        d.file_path,
        d.updated_at::text,
        EXTRACT(DAY FROM now() - d.updated_at)::int AS days_stale
      FROM docs.documents d
      WHERE d.project_id = ${projectId}::uuid
      ORDER BY d.updated_at ASC
    `);

    const docs = docsResult.rows as Array<{
      id: string; title: string; file_path: string; updated_at: string; days_stale: number;
    }>;

    let freshDocs = 0, agingDocs = 0, staleDocs = 0, criticalDocs = 0;

    const documents = docs.map((doc) => {
      const staleness = classifyStaleness(doc.days_stale);
      switch (staleness.level) {
        case 'fresh': freshDocs++; break;
        case 'aging': agingDocs++; break;
        case 'stale': staleDocs++; break;
        case 'critical': criticalDocs++; break;
      }
      return {
        documentId: doc.id,
        title: doc.title,
        filePath: doc.file_path,
        staleness: {
          level: staleness.level,
          daysStale: doc.days_stale,
          lastUpdated: doc.updated_at,
          suggestedAction: staleness.suggestedAction,
        },
        lastReadCount: 0,
        searchHitRate: 0,
      };
    });

    const totalDocs = docs.length;
    // Score: weighted by freshness (fresh=100, aging=70, stale=30, critical=0)
    const overallScore = totalDocs > 0
      ? Math.round(
          ((freshDocs * 100 + agingDocs * 70 + staleDocs * 30 + criticalDocs * 0) / totalDocs)
        )
      : 100;

    return Response.json({
      health: {
        totalDocs,
        freshDocs,
        agingDocs,
        staleDocs,
        criticalDocs,
        overallScore,
        documents: documents.slice(0, 20), // Limit to 20 docs
      },
    });
  },
);
