/**
 * Knowledge Base AI Ask API
 * POST /api/knowledge-base/ask
 *
 * Performs RAG: vector search -> retrieve context -> Gemini 2.0 Flash answer
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/supabase';
import { searchDocuments } from '@/lib/quoth/search';
import { generateRAGAnswer, isGenerativeAIConfigured, type RAGContext } from '@/lib/ai';

export async function POST(request: Request) {
  try {
    const authSupabase = await createServerSupabaseClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's project membership (use limit(1) instead of single() for multi-project users)
    const { data: memberships, error: membershipError } = await authSupabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', user.id)
      .limit(1);

    if (membershipError) {
      console.error('Membership query error:', membershipError);
      return Response.json({ error: 'Failed to verify project access' }, { status: 500 });
    }

    const membership = memberships?.[0];
    if (!membership) {
      return Response.json({ error: 'No project access' }, { status: 403 });
    }

    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    // 1. Vector search to get relevant documents
    const searchResults = await searchDocuments(query, membership.project_id);

    // 2. Check if generative AI is configured
    if (!isGenerativeAIConfigured()) {
      // Return search results only without AI answer
      return Response.json({
        aiAnswer: null,
        sources: [],
        relatedQuestions: [],
        results: searchResults,
        aiEnabled: false,
      });
    }

    // 3. Fetch full content for top results to build context
    const topResults = searchResults.slice(0, 5);
    const contexts: RAGContext[] = [];

    for (const result of topResults) {
      // Get full document content
      const { data: doc, error: fetchError } = await supabase
        .from('documents')
        .select('content')
        .eq('project_id', membership.project_id)
        .eq('file_path', result.path)
        .single();

      if (fetchError) {
        console.error('Document fetch error:', fetchError.message, 'for path:', result.path);
        continue; // Skip this document but continue with others
      }

      if (doc) {
        contexts.push({
          title: result.title,
          path: result.path,
          content: doc.content.slice(0, 3000), // Limit content per doc
          relevance: result.relevance,
        });
      }
    }

    // 4. Generate AI answer using Gemini 2.0 Flash
    const ragAnswer = await generateRAGAnswer(query, contexts);

    return Response.json({
      aiAnswer: ragAnswer.answer,
      sources: ragAnswer.sources,
      relatedQuestions: ragAnswer.relatedQuestions,
      results: searchResults,
      aiEnabled: true,
    });
  } catch (error) {
    console.error('Ask error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Ask failed' },
      { status: 500 }
    );
  }
}
