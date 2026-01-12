-- Migration to update embedding vector size for Jina v3 (Matryoshka 512)
-- WARNING: This is a destructive operation for existing embeddings if you run TRUNCATE.
-- Ideally, we clear old mismatched embeddings and re-index.

-- Enable vector extension if not enabled (should exist)
CREATE EXTENSION IF NOT EXISTS vector;

-- Option 1: Truncate and alter (Clean Slate Approach - RECOMMENDED for this upgrade)
TRUNCATE TABLE document_embeddings;

-- Alter the column to 512 dimensions
ALTER TABLE document_embeddings 
ALTER COLUMN embedding TYPE vector(512);

-- Drop old index if exists (usually on 768 or 1536 dims)
DROP INDEX IF EXISTS document_embeddings_embedding_idx;

-- Create new HNSW index for 512 dimensions
CREATE INDEX document_embeddings_embedding_idx 
ON document_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
