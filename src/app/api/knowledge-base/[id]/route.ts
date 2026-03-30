/**
 * GET /api/knowledge-base/{id}
 *
 * Fetch a single document from docs.documents by ID,
 * scoped to the authenticated user's org.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { documents } from '@/db/schema';

interface DocumentResponse {
  id: string;
  title: string;
  content: string;
  version: number;
  lastUpdated: string;
  path: string;
  history: never[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Auth check
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
  }

  const db = getDb();

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      version: documents.version,
      updatedAt: documents.updatedAt,
      filePath: documents.filePath,
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.orgId, ctx.orgId)))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const doc = rows[0];

  const response: DocumentResponse = {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    version: doc.version ?? 1,
    lastUpdated: doc.updatedAt?.toISOString() ?? new Date().toISOString(),
    path: doc.filePath,
    history: [],
  };

  return NextResponse.json(response);
}
