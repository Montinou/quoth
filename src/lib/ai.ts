import { GoogleGenerativeAI } from "@google/generative-ai";

// Use GEMINIAI_API_KEY (as configured in Vercel) or fall back to GOOGLE_API_KEY
const googleApiKey = process.env.GEMINIAI_API_KEY || process.env.GOOGLE_API_KEY;
const jinaApiKey = process.env.JINA_API_KEY;

if (!googleApiKey) {
  console.warn("Warning: No Gemini API key found (GEMINIAI_API_KEY or GOOGLE_API_KEY)");
}

if (!jinaApiKey) {
  console.warn("Warning: No Jina API key found (JINA_API_KEY). Semantic search for code will fail.");
}

const genAI = googleApiKey ? new GoogleGenerativeAI(googleApiKey) : null;
const googleModel = genAI?.getGenerativeModel({ model: "text-embedding-004" });

/**
 * Generate embedding using Jina Embeddings v3 (optimized for code)
 */
export async function generateJinaEmbedding(text: string): Promise<number[]> {
  if (!jinaApiKey) {
    throw new Error("Jina API not configured. Set JINA_API_KEY");
  }

  const cleanText = text.replace(/\n+/g, " ").trim();
  if (!cleanText) return [];

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jinaApiKey}`
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'retrieval.passage', // optimized for storing docs
      dimensions: 512, // Matryoshka optimized
      late_chunking: false, // keeping it simple for now as per plan
      input: [cleanText]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jina API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate embedding for search query using Jina
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
   if (!jinaApiKey) {
    throw new Error("Jina API not configured. Set JINA_API_KEY");
  }

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jinaApiKey}`
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'retrieval.query', // optimized for queries
      dimensions: 512,
      input: [query]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jina API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Legacy/Fallback: Generate a 768-dimensional embedding vector for text
 * Uses Google Gemini text-embedding-004 model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Prefer Jina if available for this new architecture
  if (jinaApiKey) {
    try {
      return await generateJinaEmbedding(text);
    } catch (e) {
      console.warn("Jina generation failed, falling back to Gemini", e);
    }
  }

  if (!googleModel) {
    throw new Error("Gemini API not configured. Set GEMINIAI_API_KEY or GOOGLE_API_KEY");
  }

  // Clean text for better semantic quality
  const cleanText = text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    throw new Error("Cannot generate embedding for empty text");
  }

  const result = await googleModel.embedContent(cleanText);
  return result.embedding.values; // Returns array of 768 numbers
}

/**
 * Check if AI embedding service is configured
 */
export function isAIConfigured(): boolean {
  return !!googleApiKey || !!jinaApiKey;
}

/**
 * Batch generate embeddings with rate limiting
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  delayMs: number = 1000 
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);

    // Add delay between requests (except for last one)
    if (i < texts.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return embeddings;
}
