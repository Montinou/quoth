/**
 * POST /api/knowledge-base/ask
 *
 * Semantic search over docs.chunks using cosine similarity,
 * joining to docs.documents for document metadata.
 * Returns top 10 results. aiAnswer is always null (LLM disabled).
 */


import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getSecureDb } from '@/db/connection';
import { generateEmbedding } from '@/lib/embeddings/gateway';

interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  filePath: string;
  docType: string | null;
  snippet: string;
  similarity: number;
}

interface AskResponse {
  results: SearchResult[];
  aiAnswer: null;
  sources: string[];
  relatedQuestions: never[];
  aiEnabled: false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth check
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).query !== 'string' ||
    !(body as Record<string, unknown>).query
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid field: query (string required)' },
      { status: 400 },
    );
  }

  const query = ((body as Record<string, unknown>).query as string).trim();
  if (!query) {
    return NextResponse.json({ error: 'query must not be empty' }, { status: 400 });
  }

  // Generate embedding for query
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch (err) {
    console.error('[knowledge-base/ask] Embedding error:', err);
    return NextResponse.json({ error: 'Failed to generate query embedding' }, { status: 502 });
  }

  const db = await getSecureDb(ctx.orgId, ctx.userId);

  // Cosine similarity search over docs.chunks, scoped to org
  // 1 - cosine_distance = cosine similarity
  const embeddingLiteral = `'[${queryEmbedding.join(',')}]'::vector`;

  const rows = await db.execute(sql`
    SELECT
      c.id            AS chunk_id,
      c.document_id,
      c.title,
      c.file_path,
      c.content,
      d.doc_type,
      1 - (c.embedding <=> ${sql.raw(embeddingLiteral)}) AS similarity
    FROM docs.chunks c
    JOIN docs.documents d ON d.id = c.document_id
    WHERE
      d.org_id = ${ctx.orgId}::uuid
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${sql.raw(embeddingLiteral)}
    LIMIT 10
  `);

  const results: SearchResult[] = (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    chunkId: row.chunk_id as string,
    documentId: row.document_id as string,
    title: row.title as string,
    filePath: row.file_path as string,
    docType: (row.doc_type as string | null) ?? null,
    snippet: ((row.content as string) ?? '').slice(0, 200),
    similarity: parseFloat(String(row.similarity ?? 0)),
  }));

  const sources = [...new Set(results.map((r) => r.filePath))];

  const response: AskResponse = {
    results,
    aiAnswer: null,
    sources,
    relatedQuestions: [],
    aiEnabled: false,
  };

  return NextResponse.json(response);
}
