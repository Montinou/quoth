/**
 * GitHub Webhook Handler
 * Syncs changes from GitHub back to Supabase when files are pushed
 */

import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/ai';
import matter from 'gray-matter';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify webhook signature
    const signature = request.headers.get('x-hub-signature-256');
    const body = await request.text();

    if (!verifySignature(body, signature)) {
      console.error('Invalid webhook signature');
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 2. Parse webhook payload
    const payload = JSON.parse(body);

    // Only process pushes to main branch
    if (payload.ref !== 'refs/heads/main') {
      return Response.json({ message: 'Not main branch, ignoring' });
    }

    // 3. Process commits that affect quoth-knowledge-base/
    const commits = payload.commits || [];
    const affectedFiles: string[] = [];

    for (const commit of commits) {
      const files = [
        ...(commit.added || []),
        ...(commit.modified || [])
      ].filter((file: string) => file.startsWith('quoth-knowledge-base/'));

      affectedFiles.push(...files);
    }

    // Remove duplicates
    const uniqueFiles = [...new Set(affectedFiles)];

    console.log(`Webhook: Processing ${uniqueFiles.length} files from GitHub`);

    // 4. Sync each affected file
    for (const filePath of uniqueFiles) {
      try {
        await syncFileFromGitHub(filePath);
      } catch (error) {
        console.error(`Failed to sync ${filePath}:`, error);
        // Continue with other files even if one fails
      }
    }

    return Response.json({
      message: 'Webhook processed',
      files_synced: uniqueFiles.length
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Verifies webhook signature using HMAC SHA-256
 */
function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !WEBHOOK_SECRET) {
    console.warn('No webhook signature or secret configured');
    return false;
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = `sha256=${hmac.update(body).digest('hex')}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * Syncs a single file from GitHub to Supabase
 */
async function syncFileFromGitHub(filePath: string) {
  const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Montinou';
  const GITHUB_REPO = process.env.GITHUB_REPO || 'quoth-mcp';

  try {
    console.log(`Syncing ${filePath} from GitHub...`);

    // 1. Fetch file content from GitHub
    const response = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${filePath}`
    );

    if (!response.ok) {
      throw new Error(`GitHub fetch failed: ${response.status}`);
    }

    const content = await response.text();

    // 2. Parse frontmatter
    const { data: frontmatter, content: markdown } = matter(content);

    // 3. Get project
    const projectSlug = process.env.QUOTH_PROJECT_SLUG || 'quoth-knowledge-base';
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('slug', projectSlug)
      .single();

    if (!project) {
      throw new Error(`Project "${projectSlug}" not found`);
    }

    // 4. Calculate checksum
    const checksum = crypto.createHash('md5').update(content).digest('hex');

    // 5. Upsert document
    const relativePath = filePath.replace('quoth-knowledge-base/', '');
    const { data: doc } = await supabase
      .from('documents')
      .upsert({
        project_id: project.id,
        file_path: relativePath,
        title: frontmatter.id || relativePath,
        content: markdown,
        checksum,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'project_id,file_path'
      })
      .select()
      .single();

    if (!doc) {
      throw new Error('Failed to upsert document');
    }

    // 6. Delete old embeddings
    await supabase
      .from('document_embeddings')
      .delete()
      .eq('document_id', doc.id);

    // 7. Generate new embeddings (chunked by H2 headers)
    const chunks = markdown.split(/(?=^## )/gm).filter(Boolean);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const embedding = await generateEmbedding(chunk);

        await supabase
          .from('document_embeddings')
          .insert({
            document_id: doc.id,
            content_chunk: chunk,
            embedding,
            metadata: { chunk_index: i, source: 'github-sync' }
          });

        // Rate limit: 4.2s between requests (15 RPM for Gemini)
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 4200));
        }
      } catch (error) {
        console.error(`Failed to generate embedding for chunk ${i}:`, error);
        // Continue with other chunks
      }
    }

    console.log(`✓ Synced ${filePath} (${chunks.length} chunks)`);
  } catch (error) {
    console.error(`Failed to sync ${filePath}:`, error);
    throw error;
  }
}
