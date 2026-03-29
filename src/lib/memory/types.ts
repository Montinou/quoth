/**
 * Agent Memory Service Types
 * MEM-02: Type definitions for agent memory storage and retrieval.
 */

export interface MemoryEntry {
  id: string;
  agentId: string;
  key: string;
  value: string;
  namespace: string;
  tier: "working" | "persistent";
  relevanceScore: number;
  accessCount: number;
  tags: string[];
  metadata: Record<string, unknown>;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreMemoryInput {
  key: string;
  value: string;
  namespace?: string; // default: 'default'
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  ttlSeconds?: number;
  projectId?: string;
}

export interface SearchMemoryInput {
  query: string;
  namespace?: string;
  tier?: "working" | "persistent";
  limit?: number; // default: 10
  threshold?: number; // default: 0.3
}

export interface SearchMemoryResult extends MemoryEntry {
  similarity: number;
}

export interface ListMemoryOptions {
  namespace?: string;
  tier?: "working" | "persistent";
  limit?: number; // default: 50
  offset?: number; // default: 0
}
