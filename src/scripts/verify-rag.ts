import { astChunker } from "../lib/quoth/chunking";
import { generateJinaEmbedding, isAIConfigured } from "../lib/ai";
import dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback

async function verify() {
  console.log("Starting Next-Gen RAG Layout Verification...");

  // 1. Verify Dependencies
  try {
    const isConfigured = isAIConfigured();
    console.log(`AI Configured: ${isConfigured ? '✅' : '❌'}`);
  } catch (e) {
    console.error("AI Configuration Check Failed", e);
  }

  // 2. Verify AST Ingestion
  console.log("\nTesting AST Chunking...");
  const dummyTs = `
  /**
   * Test Function
   */
  export function test(a: number) {
    return a * 2;
  }
  
  class TestClass {
     method() { console.log('hi'); }
  }
  `;
  
  try {
    const chunks = await astChunker.chunkFile('test.ts', dummyTs);
    console.log(`Chunks found: ${chunks.length}`);
    chunks.forEach(c => console.log(`- [${c.type}] ${c.content.substring(0, 20)}...`));
    
    if (chunks.length > 0 && chunks[0].type.includes('function')) {
       console.log("AST Parsing: ✅ Success");
    } else {
       console.warn("AST Parsing: ⚠️ Fallback or unexpected result");
    }
  } catch (e) {
    console.error("AST Verification Failed", e);
  }

  // 3. Verify Jina Embeddings
  console.log("\nTesting Jina Embeddings...");
  if (process.env.JINA_API_KEY) {
    try {
        const vec = await generateJinaEmbedding("test query");
        console.log(`Generated Vector Dimension: ${vec.length}`);
        if (vec.length === 512) {
            console.log("Jina + Matryoshka (512): ✅ Success");
        } else {
             console.warn(`Jina Warning: Expected 512 dims, got ${vec.length}`);
        }
    } catch (e) {
        console.error("Jina Embedding Failed", e);
    }
  } else {
      console.log("Skipping Jina test (No API Key in env)");
  }
}

verify().catch(console.error);
