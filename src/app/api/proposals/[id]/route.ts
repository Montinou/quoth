/**
 * Proposals API - Detail Endpoint
 * GET /api/proposals/:id - Get single proposal with all details
 */

import { supabase } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabase
      .from('document_proposals')
      .select(`
        *,
        documents (
          id,
          title,
          file_path
        )
      `)
      .eq('id', params.id)
      .single();

    if (error || !data) {
      return Response.json(
        { error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return Response.json({ proposal: data });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
