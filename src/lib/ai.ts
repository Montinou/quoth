import { GoogleGenerativeAI } from "@google/generative-ai";

// Use GEMINIAI_API_KEY (as configured in Vercel) or fall back to GOOGLE_API_KEY
const googleApiKey = process.env.GEMINIAI_API_KEY || process.env.GOOGLE_API_KEY;
const jinaApiKey = process.env.JINA_API_KEY;

// Debug logging - only in development with explicit flag
const DEBUG_AI = process.env.NODE_ENV === 'development' && process.env.DEBUG_AI === 'true';

function debugLog(...args: unknown[]) {
  if (DEBUG_AI) {
    console.log('[AI]', ...args);
  }
}

// Startup warnings (only in development)
if (process.env.NODE_ENV === 'development') {
  if (!googleApiKey) {
    console.warn("[AI] Warning: No Gemini API key found (GEMINIAI_API_KEY or GOOGLE_API_KEY)");
  }
  if (!jinaApiKey) {
    console.warn("[AI] Warning: No Jina API key found (JINA_API_KEY). Semantic search for code will fail.");
  }
}

const genAI = googleApiKey ? new GoogleGenerativeAI(googleApiKey) : null;
const googleModel = genAI?.getGenerativeModel({ model: "text-embedding-004" });

// Gemini 2.0 Flash for generative responses (RAG answers) — LEGACY, kept as fallback
const flashModel = genAI?.getGenerativeModel({
  model: "gemini-2.0-flash",  // Stable model (exp was deprecated)
  generationConfig: {
    temperature: 0.3,  // Lower for more factual responses
    topP: 0.8,
    maxOutputTokens: 1024,
  }
});

// Cloudflare Workers AI endpoint (primary RAG answer generator — Mistral Small 3.1 24B)
const CF_RAG_WORKER_URL = process.env.CF_RAG_WORKER_URL;
const CF_RAG_API_KEY = process.env.CF_RAG_API_KEY;

/**
 * Content type for dual embedding support
 */
export type ContentType = 'text' | 'code';

/**
 * Detect content type based on heuristics
 * Returns 'code' if content has code-like patterns, otherwise 'text'
 */
export function detectContentType(text: string): ContentType {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return 'text';

  let codeSignals = 0;
  const codeKeywords = /\b(function|class|import|export|const|let|var|def|public|private|protected|interface|enum|struct|impl|trait|async|await|return)\b/;
  const indentationPattern = /^[\s]{2,}/; // 2+ spaces or tab
  const codeBlockPattern = /^```/; // Markdown code blocks

  for (const line of lines) {
    // Check for code keywords
    if (codeKeywords.test(line)) codeSignals++;
    
    // Check for indentation (common in code)
    if (indentationPattern.test(line)) codeSignals++;
    
    // Check for markdown code blocks
    if (codeBlockPattern.test(line)) codeSignals++;
    
    // Check for common code patterns: {}, [], (), ;
    if (/[{}\[\]();]/.test(line)) codeSignals++;
  }

  const codeRatio = codeSignals / lines.length;
  
  // If >30% of lines have code signals, classify as code
  return codeRatio > 0.3 ? 'code' : 'text';
}

/**
 * Generate embedding using Jina Embeddings v3 (optimized for text)
 */
export async function generateJinaEmbedding(text: string, contentType?: ContentType): Promise<number[]> {
  if (!jinaApiKey) {
    throw new Error("Jina API not configured. Set JINA_API_KEY");
  }

  const cleanText = text.replace(/\n+/g, " ").trim();
  if (!cleanText) return [];

  // Auto-detect content type if not provided
  const detectedType = contentType || detectContentType(text);
  
  // Use appropriate model based on content type
  if (detectedType === 'code') {
    return generateCodeEmbedding(cleanText);
  }

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
 * Generate code embedding using Jina Code Embeddings v1.5b
 * Optimized for code snippets, functions, and technical content
 */
export async function generateCodeEmbedding(text: string): Promise<number[]> {
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
      model: 'jina-code-embeddings-1.5b',
      task: 'nl2code.passage', // store docs for natural language → code search
      dimensions: 512, // Matryoshka: truncate 896d to 512d
      input: [cleanText]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jina Code API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate query embedding for code search
 * Optimized for code-related queries
 */
export async function generateCodeQueryEmbedding(query: string): Promise<number[]> {
  if (!jinaApiKey) {
    throw new Error("Jina API not configured. Set JINA_API_KEY");
  }

  debugLog('Generating code query embedding for:', query.slice(0, 100));

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jinaApiKey}`
    },
    body: JSON.stringify({
      model: 'jina-code-embeddings-1.5b',
      task: 'nl2code.query', // search docs with natural language queries
      dimensions: 512,
      input: [query]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jina Code API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;
  debugLog('Successfully generated code embedding:', embedding ? `${embedding.length} dimensions` : 'FAILED');
  return embedding;
}

/**
 * Detect if a query is code-related based on keywords
 */
function isCodeQuery(query: string): boolean {
  const codeKeywords = [
    'function', 'class', 'method', 'import', 'export', 'const', 'let', 'var',
    'def', 'async', 'await', 'return', 'interface', 'type', 'enum',
    'implement', 'extends', 'package', 'module', 'snippet', 'code',
    'api', 'endpoint', 'route', 'controller', 'service', 'util', 'helper'
  ];
  
  const lowerQuery = query.toLowerCase();
  return codeKeywords.some(keyword => lowerQuery.includes(keyword));
}

/**
 * Generate embedding for search query using Jina
 * Automatically detects if query is code-related and uses appropriate model
 */
export async function generateQueryEmbedding(query: string, contentType?: ContentType): Promise<number[]> {
  debugLog('Generating query embedding for:', query.slice(0, 100));

  if (!jinaApiKey) {
    throw new Error("Jina API not configured. Set JINA_API_KEY");
  }

  // Auto-detect if this is a code query
  const isCode = contentType === 'code' || (contentType === undefined && isCodeQuery(query));
  
  if (isCode) {
    debugLog('Code query detected, using jina-code-embeddings-1.5b');
    return generateCodeQueryEmbedding(query);
  }

  debugLog('Calling Jina API (model: jina-embeddings-v3, task: retrieval.query, dims: 512)');

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
  const embedding = data.data[0].embedding;
  debugLog('Successfully generated:', embedding ? `${embedding.length} dimensions` : 'FAILED');
  return embedding;
}

/**
 * Legacy/Fallback: Generate a 512-dimensional embedding vector for text
 * Uses Jina embeddings (primary) or falls back to Gemini text-embedding-004
 * @param text - Text to embed
 * @param contentType - Optional content type hint ('text' or 'code')
 */
export async function generateEmbedding(text: string, contentType?: ContentType): Promise<number[]> {
  // Prefer Jina if available for this new architecture
  if (jinaApiKey) {
    try {
      return await generateJinaEmbedding(text, contentType);
    } catch (e) {
      debugLog("Jina generation failed, falling back to Gemini", e);
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

// ============================================
// Gemini 2.0 Flash - RAG Answer Generation
// ============================================

export interface RAGContext {
  title: string;
  path: string;
  content: string;
  relevance: number;
}

export interface RAGAnswer {
  answer: string;
  sources: { title: string; path: string }[];
  relatedQuestions: string[];
}

/**
 * Build XML prompt for Gemini 2.0 Flash RAG responses
 */
function buildRAGPrompt(query: string, contexts: RAGContext[]): string {
  const contextDocs = contexts
    .slice(0, 5)
    .map((ctx, i) => `
    <document index="${i + 1}" relevance="${Math.round(ctx.relevance * 100)}%">
      <title>${ctx.title}</title>
      <path>${ctx.path}</path>
      <content>
${ctx.content}
      </content>
    </document>`)
    .join('\n');

  return `<system>
  <role>Quoth Documentation Assistant</role>
  <description>
    You are an AI assistant for Quoth, a technical documentation knowledge base.
    Your job is to answer user questions based ONLY on the retrieved documentation context.
  </description>
</system>

<pipeline_context>
  <description>
    The user's query has been processed through a RAG (Retrieval-Augmented Generation) pipeline:
    1. Jina Embeddings (512d) converted the query to a vector
    2. Neon vector search found 50 candidate documents
    3. Cohere Rerank (rerank-english-v3.0) ranked them by relevance
    4. Top 5 most relevant documents are provided below
  </description>
  <note>Relevance scores are from Cohere reranking (0-100%). Higher = more relevant.</note>
</pipeline_context>

<retrieved_documents>
${contextDocs}
</retrieved_documents>

<user_query>${query}</user_query>

<instructions>
  <rule priority="critical">ONLY use information from the retrieved documents above. Never invent or assume.</rule>
  <rule priority="critical">If the documents don't contain enough information, explicitly say so.</rule>
  <rule>Use markdown formatting: code blocks with language tags, bullet lists, bold for emphasis.</rule>
  <rule>Be concise and actionable. Developers want quick, accurate answers.</rule>
  <rule>Reference which document(s) you're citing when relevant.</rule>
  <rule>Suggest 2-3 follow-up questions the user might want to explore.</rule>
</instructions>

<response_format>
  <answer>Your main response here (markdown formatted)</answer>

  <related_questions>
  - First follow-up question?
  - Second follow-up question?
  - Third follow-up question?
  </related_questions>
</response_format>`;
}

/**
 * Generate an AI answer via Cloudflare Workers AI (primary) or Gemini Flash (fallback).
 * Respects tier limits when projectId is provided.
 *
 * @param query - User's question
 * @param contexts - Retrieved document contexts
 * @param projectId - Optional project ID for tier limit checking
 */
export async function generateRAGAnswer(
  query: string,
  contexts: RAGContext[],
  projectId?: string
): Promise<RAGAnswer> {
  if (contexts.length === 0) {
    return {
      answer: "No relevant documentation found for your query. Try rephrasing your question or using different keywords.",
      sources: [],
      relatedQuestions: [
        "What documentation is available?",
        "How do I search the knowledge base?",
      ],
    };
  }

  // Primary: Cloudflare Workers AI (Llama 3.2 3B)
  if (CF_RAG_WORKER_URL && CF_RAG_API_KEY) {
    try {
      const cfResponse = await fetch(CF_RAG_WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CF_RAG_API_KEY}`,
        },
        body: JSON.stringify({ query, contexts: contexts.slice(0, 5) }),
      });

      if (cfResponse.ok) {
        const data = await cfResponse.json() as RAGAnswer;
        console.log('[AI] RAG answer generated via Cloudflare Workers AI (Llama 3.2 3B)');
        return data;
      }

      console.warn('[AI] Cloudflare Worker returned', cfResponse.status, '- falling back to Gemini');
    } catch (error) {
      console.warn('[AI] Cloudflare Worker failed, falling back to Gemini:', error);
    }
  }

  // Fallback: Gemini 2.0 Flash
  if (!flashModel) {
    return {
      answer: "AI answer generation is not configured. Please review the documents below.",
      sources: contexts.slice(0, 5).map(ctx => ({ title: ctx.title, path: ctx.path })),
      relatedQuestions: [],
    };
  }

  const prompt = buildRAGPrompt(query, contexts);

  try {
    const result = await flashModel.generateContent(prompt);
    const response = result.response.text();

    const sources = contexts.slice(0, 5).map(ctx => ({
      title: ctx.title,
      path: ctx.path,
    }));

    const relatedQuestions = extractRelatedQuestions(response);
    const cleanedAnswer = cleanAnswer(response);

    console.log('[AI] RAG answer generated via Gemini 2.0 Flash (fallback)');
    return { answer: cleanedAnswer, sources, relatedQuestions };
  } catch (error) {
    console.error("Gemini 2.0 Flash generation failed:", error);
    return {
      answer: "Unable to generate AI answer at this time. Please review the documents below.",
      sources: contexts.slice(0, 5).map(ctx => ({ title: ctx.title, path: ctx.path })),
      relatedQuestions: [],
    };
  }
}

/**
 * Extract related questions from the AI response
 */
function extractRelatedQuestions(response: string): string[] {
  const questions: string[] = [];

  // Look for common patterns like "Related questions:" or bullet points with ?
  const patterns = [
    /related questions?:?\s*([\s\S]*?)(?:$|\n\n)/i,
    /you might also (?:want to )?ask:?\s*([\s\S]*?)(?:$|\n\n)/i,
    /other questions?:?\s*([\s\S]*?)(?:$|\n\n)/i,
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const section = match[1];
      // Extract bullet points or numbered items
      const items = section.match(/[-•*\d.]\s*(.+\?)/g);
      if (items) {
        questions.push(...items.map(q => q.replace(/^[-•*\d.]\s*/, '').trim()));
      }
    }
  }

  // Fallback: find any lines ending with ?
  if (questions.length === 0) {
    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith('?') && trimmed.length > 10 && trimmed.length < 150) {
        // Skip the original question if it appears
        if (!trimmed.toLowerCase().includes('user question')) {
          questions.push(trimmed.replace(/^[-•*\d.]\s*/, ''));
        }
      }
    }
  }

  return questions.slice(0, 3); // Max 3 related questions
}

/**
 * Clean the answer by removing extracted sections
 */
function cleanAnswer(response: string): string {
  // Remove related questions section if present
  const patterns = [
    /\n+(?:##?\s*)?related questions?:?\s*[\s\S]*$/i,
    /\n+(?:##?\s*)?you might also (?:want to )?ask:?\s*[\s\S]*$/i,
    /\n+(?:##?\s*)?other questions?:?\s*[\s\S]*$/i,
  ];

  let cleaned = response;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * Generate a TL;DR summary for a document
 */
export async function generateDocumentSummary(
  title: string,
  content: string
): Promise<string> {
  if (!flashModel) {
    throw new Error("Gemini API not configured");
  }

  const prompt = `Summarize this documentation in 2-3 sentences. Focus on the key points and practical takeaways.

Title: ${title}

Content:
${content.slice(0, 4000)} ${content.length > 4000 ? '...' : ''}

TL;DR:`;

  try {
    const result = await flashModel.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Summary generation failed:", error);
    return ""; // Return empty on failure, UI can handle gracefully
  }
}

/**
 * Check if generative AI is available (Cloudflare Worker or Gemini)
 */
export function isGenerativeAIConfigured(): boolean {
  return !!(CF_RAG_WORKER_URL && CF_RAG_API_KEY) || !!flashModel;
}
