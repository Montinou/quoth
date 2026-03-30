CREATE TABLE "analytics"."activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"event_type" text NOT NULL,
	"query" text,
	"document_id" uuid,
	"tool_name" text,
	"file_path" text,
	"result_count" integer,
	"relevance_score" numeric(5, 4),
	"response_time_ms" integer,
	"context" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "activity_event_type_check" CHECK ("analytics"."activity"."event_type" IN ('search', 'read', 'read_chunks', 'propose', 'genesis', 'pattern_match', 'pattern_inject', 'drift_detected', 'coverage_scan', 'project_create', 'project_update', 'project_delete', 'agent_register', 'agent_update', 'agent_remove', 'agent_assign_project', 'agent_unassign_project', 'agent_message_sent', 'agent_inbox_read', 'reindex', 'agent_task_created', 'agent_task_updated', 'token_generate', 'agent_provision', 'webhook_delivery', 'channel_publish', 'memory_store', 'memory_search', 'memory_list', 'memory_forget', 'consolidation', 'cache_cleanup'))
);
--> statement-breakpoint
CREATE TABLE "agents"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"label" text,
	"scopes" text[] DEFAULT ARRAY['read', 'write'],
	"project_ids" uuid[],
	"rate_limit_rpm" integer DEFAULT 60,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"created_by" uuid,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "agents"."memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text DEFAULT 'text-embedding-3-small',
	"tier" text DEFAULT 'working' NOT NULL,
	"relevance_score" double precision DEFAULT 1 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now(),
	"decay_rate" double precision DEFAULT 0.05,
	"tags" text[],
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"source" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "memory_tier_check" CHECK ("agents"."memory"."tier" IN ('working', 'persistent'))
);
--> statement-breakpoint
CREATE TABLE "agents"."agent_projects" (
	"agent_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text DEFAULT 'contributor',
	"assigned_at" timestamp with time zone DEFAULT now(),
	"assigned_by" uuid,
	CONSTRAINT "agent_projects_agent_id_project_id_pk" PRIMARY KEY("agent_id","project_id"),
	CONSTRAINT "agent_projects_role_check" CHECK ("agents"."agent_projects"."role" IN ('owner', 'contributor', 'readonly'))
);
--> statement-breakpoint
CREATE TABLE "agents"."registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"display_name" text,
	"instance" text NOT NULL,
	"model" text,
	"role" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"signing_key" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "registry_agent_name_check" CHECK ("agents"."registry"."agent_name" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "registry_role_check" CHECK ("agents"."registry"."role" IN ('orchestrator', 'specialist', 'curator', 'admin', 'agent')),
	CONSTRAINT "registry_status_check" CHECK ("agents"."registry"."status" IN ('active', 'inactive', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "comms"."channel_subscriptions" (
	"channel_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "channel_subscriptions_channel_id_agent_id_pk" PRIMARY KEY("channel_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "comms"."channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"channel_type" text DEFAULT 'topic' NOT NULL,
	"project_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "channels_name_check" CHECK ("comms"."channels"."name" ~ '^[a-z0-9._-]+$'),
	CONSTRAINT "channels_channel_type_check" CHECK ("comms"."channels"."channel_type" IN ('topic', 'direct', 'project'))
);
--> statement-breakpoint
CREATE TABLE "docs"."chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"content" text NOT NULL,
	"chunk_hash" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"title" text NOT NULL,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"content_tsv" text
);
--> statement-breakpoint
CREATE TABLE "analytics"."coverage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"docs_with_embeddings" integer DEFAULT 0 NOT NULL,
	"total_chunks" integer DEFAULT 0 NOT NULL,
	"coverage_percentage" numeric(5, 2),
	"breakdown" jsonb DEFAULT '{}'::jsonb,
	"scan_type" text DEFAULT 'manual',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "coverage_snapshots_scan_type_check" CHECK ("analytics"."coverage_snapshots"."scan_type" IN ('manual', 'scheduled', 'genesis'))
);
--> statement-breakpoint
CREATE TABLE "docs"."document_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"checksum" text NOT NULL,
	"changed_by" uuid,
	"change_type" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "document_history_change_type_check" CHECK ("docs"."document_history"."change_type" IN ('create', 'update', 'rollback'))
);
--> statement-breakpoint
CREATE TABLE "docs"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"checksum" text NOT NULL,
	"doc_type" text,
	"visibility" text DEFAULT 'project' NOT NULL,
	"tags" text[],
	"agent_id" uuid,
	"indexing_status" text DEFAULT 'pending',
	"version" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "documents_doc_type_check" CHECK ("docs"."documents"."doc_type" IN ('architecture', 'testing-pattern', 'contract', 'meta', 'template', 'rules', 'patterns', 'reference', 'api', 'guide')),
	CONSTRAINT "documents_visibility_check" CHECK ("docs"."documents"."visibility" IN ('project', 'shared', 'public')),
	CONSTRAINT "documents_indexing_status_check" CHECK ("docs"."documents"."indexing_status" IN ('pending', 'indexing', 'indexed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "search"."drift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"severity" text NOT NULL,
	"drift_type" text NOT NULL,
	"file_path" text NOT NULL,
	"doc_path" text,
	"description" text NOT NULL,
	"expected_pattern" text,
	"actual_code" text,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"detected_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "drift_events_severity_check" CHECK ("search"."drift_events"."severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "drift_events_drift_type_check" CHECK ("search"."drift_events"."drift_type" IN ('code_diverged', 'missing_doc', 'stale_doc', 'pattern_violation', 'embedding_stale', 'search_quality_drop'))
);
--> statement-breakpoint
CREATE TABLE "analytics"."generations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"project_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"result" text,
	"token_usage" jsonb,
	"estimated_cost_cents" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "generations_status_check" CHECK ("analytics"."generations"."status" IN ('pending', 'streaming', 'complete', 'error'))
);
--> statement-breakpoint
CREATE TABLE "comms"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_agent_id" uuid NOT NULL,
	"to_agent_id" uuid,
	"channel_id" uuid,
	"reply_to" uuid,
	"message_type" text DEFAULT 'message' NOT NULL,
	"priority" text DEFAULT 'normal',
	"payload" jsonb NOT NULL,
	"signature" text,
	"status" text DEFAULT 'pending',
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"expires_at" timestamp with time zone DEFAULT now() + INTERVAL '7 days',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "msg_routing_check" CHECK ((to_agent_id IS NOT NULL AND channel_id IS NULL) OR (to_agent_id IS NULL AND channel_id IS NOT NULL)),
	CONSTRAINT "messages_message_type_check" CHECK ("comms"."messages"."message_type" IN ('message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast')),
	CONSTRAINT "messages_priority_check" CHECK ("comms"."messages"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "messages_status_check" CHECK ("comms"."messages"."status" IN ('pending', 'delivered', 'read', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "org_members_role_check" CHECK ("org_members"."role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "organizations_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_check" CHECK ("organizations"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "organizations_tier_check" CHECK ("organizations"."tier" IN ('free', 'pro', 'team', 'enterprise'))
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id"),
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" IN ('admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"description" text,
	"is_public" boolean DEFAULT false,
	"tier" text DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "projects_slug_check" CHECK ("projects"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "projects_tier_check" CHECK ("projects"."tier" IN ('free', 'pro', 'team', 'enterprise'))
);
--> statement-breakpoint
CREATE TABLE "docs"."proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"doc_id_ref" text NOT NULL,
	"new_content" text NOT NULL,
	"evidence_snippet" text,
	"reasoning" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_id" uuid,
	"source_instance" text,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "proposals_status_check" CHECK ("docs"."proposals"."status" IN ('pending', 'approved', 'rejected', 'applied'))
);
--> statement-breakpoint
CREATE TABLE "search"."query_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"query_hash" text NOT NULL,
	"query_text" text NOT NULL,
	"embedding_model" text NOT NULL,
	"result_ids" uuid[] NOT NULL,
	"result_scores" double precision[] NOT NULL,
	"reranked" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone DEFAULT now() + INTERVAL '1 hour'
);
--> statement-breakpoint
CREATE TABLE "search"."logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"query" text NOT NULL,
	"embedding_model" text,
	"result_count" integer DEFAULT 0 NOT NULL,
	"top_score" real,
	"reranked" boolean DEFAULT false,
	"cache_hit" boolean DEFAULT false,
	"response_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "comms"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assigned_to" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"project_id" uuid,
	"status" text DEFAULT 'pending',
	"priority" integer DEFAULT 5,
	"payload" jsonb,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tasks_status_check" CHECK ("comms"."tasks"."status" IN ('pending', 'in_progress', 'done', 'failed', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK ("comms"."tasks"."priority" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "analytics"."usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"usage_type" text NOT NULL,
	"usage_date" date DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_usage_type_check" CHECK ("analytics"."usage"."usage_type" IN ('semantic_search', 'rag_answer', 'embedding_generation', 'rerank', 'webhook_delivery'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"default_org_id" uuid,
	"default_project_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "comms"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"message_id" uuid,
	"url" text NOT NULL,
	"request_body" jsonb NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("comms"."webhook_deliveries"."status" IN ('pending', 'success', 'failed', 'retrying'))
);
--> statement-breakpoint
CREATE TABLE "agents"."webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"status" text DEFAULT 'active',
	"failure_count" integer DEFAULT 0,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "webhook_subscriptions_status_check" CHECK ("agents"."webhook_subscriptions"."status" IN ('active', 'paused', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "analytics"."activity" ADD CONSTRAINT "activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."activity" ADD CONSTRAINT "activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."api_keys" ADD CONSTRAINT "api_keys_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."memory" ADD CONSTRAINT "memory_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."memory" ADD CONSTRAINT "memory_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."memory" ADD CONSTRAINT "memory_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_projects" ADD CONSTRAINT "agent_projects_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."agent_projects" ADD CONSTRAINT "agent_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."registry" ADD CONSTRAINT "registry_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "comms"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."channels" ADD CONSTRAINT "channels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."channels" ADD CONSTRAINT "channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."chunks" ADD CONSTRAINT "chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."coverage_snapshots" ADD CONSTRAINT "coverage_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."document_history" ADD CONSTRAINT "document_history_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search"."drift_events" ADD CONSTRAINT "drift_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."generations" ADD CONSTRAINT "generations_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."generations" ADD CONSTRAINT "generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."messages" ADD CONSTRAINT "messages_from_agent_id_registry_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "agents"."registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."messages" ADD CONSTRAINT "messages_to_agent_id_registry_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "agents"."registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "comms"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."proposals" ADD CONSTRAINT "proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."proposals" ADD CONSTRAINT "proposals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."proposals" ADD CONSTRAINT "proposals_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."proposals" ADD CONSTRAINT "proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search"."query_cache" ADD CONSTRAINT "query_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search"."logs" ADD CONSTRAINT "logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."tasks" ADD CONSTRAINT "tasks_assigned_to_registry_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "agents"."registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."tasks" ADD CONSTRAINT "tasks_created_by_registry_id_fk" FOREIGN KEY ("created_by") REFERENCES "agents"."registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics"."usage" ADD CONSTRAINT "usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_org_id_organizations_id_fk" FOREIGN KEY ("default_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "agents"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "comms"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_agent_id_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents"."webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_project" ON "analytics"."activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_activity_event" ON "analytics"."activity" USING btree ("project_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_activity_agent" ON "analytics"."activity" USING btree ("agent_id") WHERE agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_api_keys_hash" ON "agents"."api_keys" USING btree ("key_hash") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_api_keys_agent" ON "agents"."api_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_org" ON "agents"."api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memory_agent_ns_key" ON "agents"."memory" USING btree ("agent_id","namespace","key");--> statement-breakpoint
CREATE INDEX "idx_memory_embedding" ON "agents"."memory" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=200) WHERE embedding IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_memory_agent_ns" ON "agents"."memory" USING btree ("agent_id","namespace");--> statement-breakpoint
CREATE INDEX "idx_memory_agent_tier" ON "agents"."memory" USING btree ("agent_id","tier");--> statement-breakpoint
CREATE INDEX "idx_memory_agent_tier_relevance" ON "agents"."memory" USING btree ("agent_id","tier","relevance_score");--> statement-breakpoint
CREATE INDEX "idx_memory_relevance" ON "agents"."memory" USING btree ("agent_id","relevance_score");--> statement-breakpoint
CREATE INDEX "idx_memory_tags" ON "agents"."memory" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_memory_expires" ON "agents"."memory" USING btree ("expires_at") WHERE expires_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_memory_project" ON "agents"."memory" USING btree ("project_id") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_agent_projects_project" ON "agents"."agent_projects" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agents_org_name" ON "agents"."registry" USING btree ("org_id","agent_name");--> statement-breakpoint
CREATE INDEX "idx_agents_org_status" ON "agents"."registry" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_agents_instance" ON "agents"."registry" USING btree ("instance","status");--> statement-breakpoint
CREATE INDEX "idx_channel_subs_agent" ON "comms"."channel_subscriptions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channels_org_name" ON "comms"."channels" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "idx_channels_org" ON "comms"."channels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_channels_project" ON "comms"."channels" USING btree ("project_id") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_chunks_embedding" ON "docs"."chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=200) WHERE embedding_model = 'text-embedding-3-small';--> statement-breakpoint
CREATE INDEX "idx_chunks_document" ON "docs"."chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_chunks_project_model" ON "docs"."chunks" USING btree ("project_id","embedding_model");--> statement-breakpoint
CREATE INDEX "idx_chunks_hash" ON "docs"."chunks" USING btree ("document_id","chunk_hash");--> statement-breakpoint
CREATE INDEX "idx_chunks_fts" ON "docs"."chunks" USING gin (content_tsv);--> statement-breakpoint
CREATE INDEX "idx_coverage_project" ON "analytics"."coverage_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_doc_history_doc" ON "docs"."document_history" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_docs_project_filepath" ON "docs"."documents" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE INDEX "idx_docs_project" ON "docs"."documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_docs_org" ON "docs"."documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_docs_visibility" ON "docs"."documents" USING btree ("visibility","org_id") WHERE visibility IN ('shared', 'public');--> statement-breakpoint
CREATE INDEX "idx_docs_tags" ON "docs"."documents" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_docs_indexing" ON "docs"."documents" USING btree ("indexing_status") WHERE indexing_status != 'indexed';--> statement-breakpoint
CREATE INDEX "idx_docs_type" ON "docs"."documents" USING btree ("project_id","doc_type");--> statement-breakpoint
CREATE INDEX "idx_docs_agent" ON "docs"."documents" USING btree ("agent_id") WHERE agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_drift_project" ON "search"."drift_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_drift_unresolved" ON "search"."drift_events" USING btree ("project_id") WHERE resolved = false;--> statement-breakpoint
CREATE INDEX "idx_generations_project" ON "analytics"."generations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_generations_user" ON "analytics"."generations" USING btree ("user_id") WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_generations_agent" ON "analytics"."generations" USING btree ("agent_id") WHERE agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_generations_status" ON "analytics"."generations" USING btree ("status") WHERE status IN ('pending', 'streaming');--> statement-breakpoint
CREATE INDEX "idx_generations_model" ON "analytics"."generations" USING btree ("project_id","model");--> statement-breakpoint
CREATE INDEX "idx_messages_inbox" ON "comms"."messages" USING btree ("to_agent_id","status","created_at") WHERE to_agent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_messages_channel" ON "comms"."messages" USING btree ("channel_id","created_at") WHERE channel_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_messages_from" ON "comms"."messages" USING btree ("from_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_pending" ON "comms"."messages" USING btree ("to_agent_id","created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "idx_messages_reply" ON "comms"."messages" USING btree ("reply_to") WHERE reply_to IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_org_members_user" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orgs_clerk" ON "organizations" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "idx_orgs_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_orgs_tier" ON "organizations" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_project_members_user" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_projects_org_slug" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "idx_projects_org" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_projects_slug" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "idx_projects_public" ON "projects" USING btree ("is_public") WHERE is_public = true;--> statement-breakpoint
CREATE INDEX "idx_proposals_project" ON "docs"."proposals" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_query_cache_unique" ON "search"."query_cache" USING btree ("project_id","query_hash","embedding_model");--> statement-breakpoint
CREATE INDEX "idx_query_cache_lookup" ON "search"."query_cache" USING btree ("project_id","query_hash","embedding_model");--> statement-breakpoint
CREATE INDEX "idx_query_cache_expire" ON "search"."query_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_search_logs_project" ON "search"."logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_search_logs_misses" ON "search"."logs" USING btree ("project_id","result_count") WHERE result_count = 0;--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned" ON "comms"."tasks" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_project" ON "comms"."tasks" USING btree ("project_id") WHERE project_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tasks_deadline" ON "comms"."tasks" USING btree ("deadline") WHERE deadline IS NOT NULL AND status IN ('pending', 'in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_usage_unique" ON "analytics"."usage" USING btree ("project_id","usage_type","usage_date");--> statement-breakpoint
CREATE INDEX "idx_usage_lookup" ON "analytics"."usage" USING btree ("project_id","usage_type","usage_date");--> statement-breakpoint
CREATE INDEX "idx_users_clerk" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_sub" ON "comms"."webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_retry" ON "comms"."webhook_deliveries" USING btree ("next_retry_at") WHERE status = 'retrying';--> statement-breakpoint
CREATE INDEX "idx_webhooks_agent" ON "agents"."webhook_subscriptions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "idx_webhooks_events" ON "agents"."webhook_subscriptions" USING gin ("events");