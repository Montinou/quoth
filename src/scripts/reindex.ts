import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback

// Dynamic imports
let astChunker: any;
let generateJinaEmbedding: any;
let calculateChecksum: any;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reindexAll() {
  console.log("Starting Mass Re-indexing...");

  // Load modules
  const chunkingModule = await import('../lib/quoth/chunking');
  astChunker = chunkingModule.astChunker;
  
  const aiModule = await import('../lib/ai');
  generateJinaEmbedding = aiModule.generateJinaEmbedding;

  const syncModule = await import('../lib/sync');
  calculateChecksum = syncModule.calculateChecksum;

  // 1. Fetch all documents
  const { data: documents, error } = await supabase
    .from('documents')
    .select('*');

  if (error) {
    console.error("Failed to fetch documents:", error);
    return;
  }

  console.log(`Found ${documents.length} documents to re-index.`);

  // 2. Initialize Chunker
  await astChunker.init();

  let successCount = 0;
  let failCount = 0;

  for (const doc of documents) {
    console.log(`Processing: ${doc.file_path}...`);
    
    try {
      // 3. Clear existing embeddings for this doc
      await supabase
        .from('document_embeddings')
        .delete()
        .eq('document_id', doc.id);

      // 4. Chunk Content (AST)
      const chunks = await astChunker.chunkFile(doc.file_path, doc.content);
      
      console.log(`  - Generated ${chunks.length} chunks (AST/Fallback)`);

      // 5. Generate Embeddings & Insert
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const hash = calculateChecksum(chunk.content);
        
        // Generate Jina embedding (512 dims)
        // Note: ai.ts handles the dimensions and model call
        const embedding = await generateJinaEmbedding(chunk.content);

        await supabase.from('document_embeddings').insert({
          document_id: doc.id,
          content_chunk: chunk.content,
          chunk_hash: hash,
          embedding: embedding,
          metadata: {
            chunk_index: i,
            source: 'reindex-script',
            reindex_date: new Date().toISOString(),
            ...chunk.metadata
          }
        });

        // Rate limit logging
        if (i % 5 === 0) process.stdout.write('.');
      }
      console.log("\n  - Done.");
      successCount++;

    } catch (e) {
      console.error(`\nFailed to process ${doc.file_path}:`, e);
      failCount++;
    }
  }

  console.log("\nRe-indexing Complete.");
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

reindexAll().catch(console.error);
