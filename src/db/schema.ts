/**
 * Drizzle ORM schema for Quoth multi-schema Neon database.
 *
 * 6 schemas: public, agents, docs, search, analytics, comms
 * All vector columns use 1536 dimensions (text-embedding-3-small).
 */

import {
  pgTable,
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  primaryKey,
  check,
  real,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vector } from "drizzle-orm/pg-core";

// ─── Schema declarations ────────────────────────────────────────────────────

const agentsSchema = pgSchema("agents");
const docsSchema = pgSchema("docs");
const searchSchema = pgSchema("search");
const analyticsSchema = pgSchema("analytics");
const commsSchema = pgSchema("comms");

// =============================================================
// Schema: public
// =============================================================

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkOrgId: text("clerk_org_id").unique(),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    tier: text("tier").notNull().default("free"),
    settings: jsonb("settings").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_orgs_clerk").on(t.clerkOrgId),
    index("idx_orgs_slug").on(t.slug),
    index("idx_orgs_tier").on(t.tier),
    check("organizations_slug_check", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
    check("organizations_tier_check", sql`${t.tier} IN ('free', 'pro', 'team', 'enterprise')`),
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").unique().notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    defaultOrgId: uuid("default_org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    defaultProjectId: uuid("default_project_id"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_users_clerk").on(t.clerkUserId),
    index("idx_users_email").on(t.email),
  ]
);

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("idx_org_members_user").on(t.userId),
    check("org_members_role_check", sql`${t.role} IN ('owner', 'admin', 'member')`),
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name"),
    description: text("description"),
    isPublic: boolean("is_public").default(false),
    tier: text("tier").notNull().default("free"),
    settings: jsonb("settings").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_projects_org_slug").on(t.orgId, t.slug),
    index("idx_projects_org").on(t.orgId),
    index("idx_projects_slug").on(t.orgId, t.slug),
    index("idx_projects_public").on(t.isPublic).where(sql`is_public = true`),
    check("projects_slug_check", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
    check("projects_tier_check", sql`${t.tier} IN ('free', 'pro', 'team', 'enterprise')`),
  ]
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("idx_project_members_user").on(t.userId),
    check("project_members_role_check", sql`${t.role} IN ('admin', 'editor', 'viewer')`),
  ]
);

// =============================================================
// Schema: agents
// =============================================================

export const agentRegistry = agentsSchema.table(
  "registry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    agentName: text("agent_name").notNull(),
    displayName: text("display_name"),
    instance: text("instance").notNull(),
    model: text("model"),
    role: text("role"),
    capabilities: jsonb("capabilities").default(sql`'{}'::jsonb`),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    signingKey: text("signing_key").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_agents_org_name").on(t.orgId, t.agentName),
    index("idx_agents_org_status").on(t.orgId, t.status),
    index("idx_agents_instance").on(t.instance, t.status),
    check("registry_agent_name_check", sql`${t.agentName} ~ '^[a-z0-9-]+$'`),
    check("registry_role_check", sql`${t.role} IN ('orchestrator', 'specialist', 'curator', 'admin', 'agent')`),
    check("registry_status_check", sql`${t.status} IN ('active', 'inactive', 'archived')`),
  ]
);

export const agentApiKeys = agentsSchema.table(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .references(() => agentRegistry.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    label: text("label"),
    scopes: text("scopes")
      .array()
      .default(sql`ARRAY['read', 'write']`),
    projectIds: uuid("project_ids").array(),
    rateLimitRpm: integer("rate_limit_rpm").default(60),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    index("idx_api_keys_hash").on(t.keyHash).where(sql`revoked_at IS NULL`),
    index("idx_api_keys_agent").on(t.agentId),
    index("idx_api_keys_org").on(t.orgId),
  ]
);

export const agentProjects = agentsSchema.table(
  "agent_projects",
  {
    agentId: uuid("agent_id")
      .references(() => agentRegistry.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("contributor"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow(),
    assignedBy: uuid("assigned_by"),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.projectId] }),
    index("idx_agent_projects_project").on(t.projectId),
    check("agent_projects_role_check", sql`${t.role} IN ('owner', 'contributor', 'readonly')`),
  ]
);

export const webhookSubscriptions = agentsSchema.table(
  "webhook_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .references(() => agentRegistry.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    events: text("events").array().notNull(),
    secret: text("secret").notNull(),
    status: text("status").default("active"),
    failureCount: integer("failure_count").default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_webhooks_agent").on(t.agentId, t.status),
    index("idx_webhooks_events").using("gin", t.events),
    check("webhook_subscriptions_status_check", sql`${t.status} IN ('active', 'paused', 'failed')`),
  ]
);

export const agentMemory = agentsSchema.table(
  "memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .references(() => agentRegistry.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    namespace: text("namespace").notNull().default("default"),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model").default("text-embedding-3-small"),
    tier: text("tier").notNull().default("working"),
    relevanceScore: doublePrecision("relevance_score").notNull().default(1.0),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", {
      withTimezone: true,
    }).defaultNow(),
    decayRate: doublePrecision("decay_rate").default(0.05),
    tags: text("tags").array(),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    source: text("source"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_memory_agent_ns_key").on(t.agentId, t.namespace, t.key),
    index("idx_memory_embedding")
      .using("hnsw", sql`${t.embedding} vector_cosine_ops`)
      .where(sql`embedding IS NOT NULL`)
      .with({ m: 16, ef_construction: 200 }),
    index("idx_memory_agent_ns").on(t.agentId, t.namespace),
    index("idx_memory_agent_tier").on(t.agentId, t.tier),
    index("idx_memory_agent_tier_relevance").on(t.agentId, t.tier, t.relevanceScore),
    index("idx_memory_relevance").on(t.agentId, t.relevanceScore),
    index("idx_memory_tags").using("gin", t.tags),
    index("idx_memory_expires")
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
    index("idx_memory_project")
      .on(t.projectId)
      .where(sql`project_id IS NOT NULL`),
    check(
      "memory_tier_check",
      sql`${t.tier} IN ('working', 'persistent')`
    ),
  ]
);

// =============================================================
// Schema: docs
// =============================================================

export const documents = docsSchema.table(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    filePath: text("file_path").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    checksum: text("checksum").notNull(),
    docType: text("doc_type"),
    visibility: text("visibility").notNull().default("project"),
    tags: text("tags").array(),
    agentId: uuid("agent_id").references(() => agentRegistry.id, {
      onDelete: "set null",
    }),
    indexingStatus: text("indexing_status").default("pending"),
    version: integer("version").default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_docs_project_filepath").on(t.projectId, t.filePath),
    index("idx_docs_project").on(t.projectId),
    index("idx_docs_org").on(t.orgId),
    index("idx_docs_visibility").on(t.visibility, t.orgId).where(sql`visibility IN ('shared', 'public')`),
    index("idx_docs_tags").using("gin", t.tags),
    index("idx_docs_indexing").on(t.indexingStatus).where(sql`indexing_status != 'indexed'`),
    index("idx_docs_type").on(t.projectId, t.docType),
    index("idx_docs_agent").on(t.agentId).where(sql`agent_id IS NOT NULL`),
    check("documents_doc_type_check", sql`${t.docType} IN ('architecture', 'testing-pattern', 'contract', 'meta', 'template', 'rules', 'patterns', 'reference', 'api', 'guide')`),
    check("documents_visibility_check", sql`${t.visibility} IN ('project', 'shared', 'public')`),
    check("documents_indexing_status_check", sql`${t.indexingStatus} IN ('pending', 'indexing', 'indexed', 'failed')`),
  ]
);

export const chunks = docsSchema.table(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    chunkHash: text("chunk_hash").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model")
      .notNull()
      .default("text-embedding-3-small"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    title: text("title").notNull(),
    filePath: text("file_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    // Generated tsvector column — read-only, managed by Postgres via SQL migration.
    // Mapped as text here because Drizzle lacks native tsvector support.
    // The actual column type is tsvector, created/managed by the migration SQL.
    // Do NOT write to this column — it is GENERATED ALWAYS.
    contentTsv: text("content_tsv"),
  },
  (t) => [
    index("idx_chunks_embedding")
      .using("hnsw", sql`${t.embedding} vector_cosine_ops`)
      .where(sql`embedding_model = 'text-embedding-3-small'`)
      .with({ m: 16, ef_construction: 200 }),
    index("idx_chunks_document").on(t.documentId),
    index("idx_chunks_project_model").on(t.projectId, t.embeddingModel),
    index("idx_chunks_hash").on(t.documentId, t.chunkHash),
    index("idx_chunks_fts").using("gin", sql`content_tsv`),
  ]
);

export const documentHistory = docsSchema.table(
  "document_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    checksum: text("checksum").notNull(),
    changedBy: uuid("changed_by"),
    changeType: text("change_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_doc_history_doc").on(t.documentId),
    check("document_history_change_type_check", sql`${t.changeType} IN ('create', 'update', 'rollback')`),
  ]
);

export const proposals = docsSchema.table(
  "proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    docIdRef: text("doc_id_ref").notNull(),
    newContent: text("new_content").notNull(),
    evidenceSnippet: text("evidence_snippet"),
    reasoning: text("reasoning"),
    status: text("status").notNull().default("pending"),
    agentId: uuid("agent_id").references(() => agentRegistry.id, {
      onDelete: "set null",
    }),
    sourceInstance: text("source_instance"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_proposals_project").on(t.projectId, t.status),
    check("proposals_status_check", sql`${t.status} IN ('pending', 'approved', 'rejected', 'applied')`),
  ]
);

// =============================================================
// Schema: search
// =============================================================

export const queryCache = searchSchema.table(
  "query_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    queryHash: text("query_hash").notNull(),
    queryText: text("query_text").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    resultIds: uuid("result_ids").array().notNull(),
    resultScores: doublePrecision("result_scores").array().notNull(),
    reranked: boolean("reranked").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).default(sql`now() + INTERVAL '1 hour'`),
  },
  (t) => [
    uniqueIndex("idx_query_cache_unique").on(
      t.projectId,
      t.queryHash,
      t.embeddingModel
    ),
    index("idx_query_cache_lookup").on(
      t.projectId,
      t.queryHash,
      t.embeddingModel
    ),
    index("idx_query_cache_expire").on(t.expiresAt),
  ]
);

export const searchLogs = searchSchema.table(
  "logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id"),
    agentId: uuid("agent_id"),
    query: text("query").notNull(),
    embeddingModel: text("embedding_model"),
    resultCount: integer("result_count").notNull().default(0),
    topScore: real("top_score"),
    reranked: boolean("reranked").default(false),
    cacheHit: boolean("cache_hit").default(false),
    responseTimeMs: integer("response_time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_search_logs_project").on(t.projectId),
    index("idx_search_logs_misses").on(t.projectId, t.resultCount).where(sql`result_count = 0`),
  ]
);

export const driftEvents = searchSchema.table(
  "drift_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    documentId: uuid("document_id"),
    severity: text("severity").notNull(),
    driftType: text("drift_type").notNull(),
    filePath: text("file_path").notNull(),
    docPath: text("doc_path"),
    description: text("description").notNull(),
    expectedPattern: text("expected_pattern"),
    actualCode: text("actual_code"),
    resolved: boolean("resolved").default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
    resolutionNote: text("resolution_note"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_drift_project").on(t.projectId),
    index("idx_drift_unresolved").on(t.projectId).where(sql`resolved = false`),
    check("drift_events_severity_check", sql`${t.severity} IN ('info', 'warning', 'critical')`),
    check("drift_events_drift_type_check", sql`${t.driftType} IN ('code_diverged', 'missing_doc', 'stale_doc', 'pattern_violation', 'embedding_stale', 'search_quality_drop')`),
  ]
);

// =============================================================
// Schema: analytics
// =============================================================

export const activity = analyticsSchema.table(
  "activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id"),
    agentId: uuid("agent_id"),
    eventType: text("event_type").notNull(),
    query: text("query"),
    documentId: uuid("document_id"),
    toolName: text("tool_name"),
    filePath: text("file_path"),
    resultCount: integer("result_count"),
    relevanceScore: numeric("relevance_score", { precision: 5, scale: 4 }),
    responseTimeMs: integer("response_time_ms"),
    context: jsonb("context").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_activity_project").on(t.projectId),
    index("idx_activity_event").on(t.projectId, t.eventType),
    index("idx_activity_agent").on(t.agentId).where(sql`agent_id IS NOT NULL`),
    check("activity_event_type_check", sql`${t.eventType} IN ('search', 'read', 'read_chunks', 'propose', 'genesis', 'pattern_match', 'pattern_inject', 'drift_detected', 'coverage_scan', 'project_create', 'project_update', 'project_delete', 'agent_register', 'agent_update', 'agent_remove', 'agent_assign_project', 'agent_unassign_project', 'agent_message_sent', 'agent_inbox_read', 'reindex', 'agent_task_created', 'agent_task_updated', 'token_generate', 'agent_provision', 'webhook_delivery', 'channel_publish', 'memory_store', 'memory_search', 'memory_list', 'memory_forget', 'consolidation', 'cache_cleanup')`),
  ]
);

export const coverageSnapshots = analyticsSchema.table(
  "coverage_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    totalDocuments: integer("total_documents").notNull().default(0),
    docsWithEmbeddings: integer("docs_with_embeddings").notNull().default(0),
    totalChunks: integer("total_chunks").notNull().default(0),
    // coverage_percentage is a generated column in SQL; read-only in Drizzle
    coveragePercentage: numeric("coverage_percentage", {
      precision: 5,
      scale: 2,
    }),
    breakdown: jsonb("breakdown").default(sql`'{}'::jsonb`),
    scanType: text("scan_type").default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_coverage_project").on(t.projectId),
    check("coverage_snapshots_scan_type_check", sql`${t.scanType} IN ('manual', 'scheduled', 'genesis')`),
  ]
);

export const usage = analyticsSchema.table(
  "usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    usageType: text("usage_type").notNull(),
    usageDate: date("usage_date").defaultNow().notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_usage_unique").on(t.projectId, t.usageType, t.usageDate),
    index("idx_usage_lookup").on(t.projectId, t.usageType, t.usageDate),
    check("usage_usage_type_check", sql`${t.usageType} IN ('semantic_search', 'rag_answer', 'embedding_generation', 'rerank', 'webhook_delivery')`),
  ]
);

export const generations = analyticsSchema.table(
  "generations",
  {
    id: text("id").primaryKey(), // nanoid
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    agentId: uuid("agent_id").references(() => agentRegistry.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    result: text("result"),
    tokenUsage: jsonb("token_usage"),
    estimatedCostCents: integer("estimated_cost_cents"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_generations_project").on(t.projectId),
    index("idx_generations_user").on(t.userId).where(sql`user_id IS NOT NULL`),
    index("idx_generations_agent").on(t.agentId).where(sql`agent_id IS NOT NULL`),
    index("idx_generations_status").on(t.status).where(sql`status IN ('pending', 'streaming')`),
    index("idx_generations_model").on(t.projectId, t.model),
    check("generations_status_check", sql`${t.status} IN ('pending', 'streaming', 'complete', 'error')`),
  ]
);

// =============================================================
// Schema: comms
// =============================================================

export const channels = commsSchema.table(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    channelType: text("channel_type").notNull().default("topic"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_channels_org_name").on(t.orgId, t.name),
    index("idx_channels_org").on(t.orgId),
    index("idx_channels_project").on(t.projectId).where(sql`project_id IS NOT NULL`),
    check("channels_name_check", sql`${t.name} ~ '^[a-z0-9._-]+$'`),
    check("channels_channel_type_check", sql`${t.channelType} IN ('topic', 'direct', 'project')`),
  ]
);

export const channelSubscriptions = commsSchema.table(
  "channel_subscriptions",
  {
    channelId: uuid("channel_id")
      .references(() => channels.id, { onDelete: "cascade" })
      .notNull(),
    agentId: uuid("agent_id")
      .references(() => agentRegistry.id, { onDelete: "cascade" })
      .notNull(),
    subscribedAt: timestamp("subscribed_at", {
      withTimezone: true,
    }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.agentId] }),
    index("idx_channel_subs_agent").on(t.agentId),
  ]
);

export const messages = commsSchema.table(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    fromAgentId: uuid("from_agent_id")
      .references(() => agentRegistry.id)
      .notNull(),
    toAgentId: uuid("to_agent_id").references(() => agentRegistry.id),
    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    replyTo: uuid("reply_to"),
    messageType: text("message_type").notNull().default("message"),
    priority: text("priority").default("normal"),
    payload: jsonb("payload").notNull(),
    signature: text("signature"),
    status: text("status").default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).default(sql`now() + INTERVAL '7 days'`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_messages_inbox").on(t.toAgentId, t.status, t.createdAt).where(sql`to_agent_id IS NOT NULL`),
    index("idx_messages_channel").on(t.channelId, t.createdAt).where(sql`channel_id IS NOT NULL`),
    index("idx_messages_from").on(t.fromAgentId, t.createdAt),
    index("idx_messages_pending").on(t.toAgentId, t.createdAt).where(sql`status = 'pending'`),
    index("idx_messages_reply").on(t.replyTo).where(sql`reply_to IS NOT NULL`),
    check("msg_routing_check", sql`(to_agent_id IS NOT NULL AND channel_id IS NULL) OR (to_agent_id IS NULL AND channel_id IS NOT NULL)`),
    check("messages_message_type_check", sql`${t.messageType} IN ('message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast')`),
    check("messages_priority_check", sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check("messages_status_check", sql`${t.status} IN ('pending', 'delivered', 'read', 'failed', 'expired')`),
  ]
);

// Self-referencing FK for replyTo — applied after table creation via raw SQL in migration
// Drizzle doesn't support self-referencing FKs inline; the SQL migration handles:
//   reply_to UUID REFERENCES comms.messages(id)

export const tasks = commsSchema.table(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    assignedTo: uuid("assigned_to")
      .references(() => agentRegistry.id)
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => agentRegistry.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    status: text("status").default("pending"),
    priority: integer("priority").default(5),
    payload: jsonb("payload"),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadline: timestamp("deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_tasks_assigned").on(t.assignedTo, t.status),
    index("idx_tasks_project").on(t.projectId).where(sql`project_id IS NOT NULL`),
    index("idx_tasks_deadline").on(t.deadline).where(sql`deadline IS NOT NULL AND status IN ('pending', 'in_progress')`),
    check("tasks_status_check", sql`${t.status} IN ('pending', 'in_progress', 'done', 'failed', 'cancelled')`),
    check("tasks_priority_check", sql`${t.priority} BETWEEN 1 AND 10`),
  ]
);

export const webhookDeliveries = commsSchema.table(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    requestBody: jsonb("request_body").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    attempt: integer("attempt").notNull().default(1),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    status: text("status").default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_webhook_delivery_sub").on(t.subscriptionId),
    index("idx_webhook_delivery_retry").on(t.nextRetryAt).where(sql`status = 'retrying'`),
    check("webhook_deliveries_status_check", sql`${t.status} IN ('pending', 'success', 'failed', 'retrying')`),
  ]
);
