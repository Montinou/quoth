/**
 * /api/v1/search
 *   POST — Run hybrid search against the caller's project docs.
 *
 * Delegates to the search pipeline (QUOTH-06) for vector + FTS + optional reranking.
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';

import { searchDocuments } from '@/lib/search/pipeline';
import type { SearchOptions } from '@/lib/search/types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const searchBody = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  rerank: z.boolean().optional(),
  hybridWeight: z.number().min(0).max(1).optional(),
  scope: z.enum(['project', 'shared', 'all']).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/search
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 60 },
    validate: { body: searchBody },
  },
  async (req, ctx) => {
    const body = req.validatedBody as z.infer<typeof searchBody>;

    const options: SearchOptions = {
      limit: body.limit,
      threshold: body.threshold,
      rerank: body.rerank,
      hybridWeight: body.hybridWeight,
      scope: body.scope,
    };

    const results = await searchDocuments(body.query, ctx!, options);

    return Response.json({
      data: results,
      meta: {
        query: body.query,
        resultCount: results.length,
        projectId: ctx!.projectId,
      },
    });
  },
);
