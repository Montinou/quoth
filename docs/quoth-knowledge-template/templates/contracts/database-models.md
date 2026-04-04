---
id: template-contracts-database-models
type: template
status: active
last_updated_date: "2026-01-13"
category: contracts
target_type: contract
keywords: [template, database-models, tables, schema, relations, constraints, migrations]
related_stack: []
common_queries: ["Database schema?", "Table structure?", "Relations?", "How to migrate?"]
---

# Database Models Template

## Purpose (What This Template Is For)

**Database model documents** define the data schema and relationships. Use this template when documenting tables, columns, constraints, and relationships. Ensures data integrity and helps developers understand the data model.

- Use for: SQL schema documentation, entity relationships
- Creates: `contracts/database-models.md`

**Summary:** Database models template for schema documentation.

## Table Structure (Columns, Types, Constraints)

**Table definition** pattern:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'guest')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add updated_at trigger
CREATE TRIGGER update_timestamp
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Reference: `supabase/migrations/` for migration files

**Summary:** Table structure with columns and constraints.

## Relationships (Foreign Keys, Joins)

**Relationship patterns** used:

```sql
-- One-to-Many: User has many Posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT
);

-- Many-to-Many: Posts have many Tags (via junction table)
CREATE TABLE post_tags (
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
```

**Summary:** Foreign key and relationship patterns.

## Indexes (Performance, Queries)

**Index strategy** for common queries:

```sql
-- Primary key (automatic)
-- Foreign keys (index for joins)
CREATE INDEX idx_posts_user_id ON posts(user_id);

-- Composite index for common filters
CREATE INDEX idx_posts_user_status ON posts(user_id, status);

-- Text search
CREATE INDEX idx_posts_title_search ON posts USING GIN (to_tsvector('english', title));
```

**Summary:** Index patterns for query performance.

## Row Level Security (RLS, Policies)

**RLS patterns** for multi-tenant isolation:

```sql
-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own posts
CREATE POLICY "Users see own posts"
  ON posts FOR SELECT
  USING (user_id = auth.uid());

-- Users can only update their own posts
CREATE POLICY "Users update own posts"
  ON posts FOR UPDATE
  USING (user_id = auth.uid());
```

**Summary:** Row level security patterns for data isolation.

## Common Questions (FAQ)

- **Where are migrations?** In `supabase/migrations/` directory
- **How to add a column?** Create migration with `ALTER TABLE ADD COLUMN`
- **How are relations defined?** Using `REFERENCES` for foreign keys
- **What's the ID format?** UUID with `gen_random_uuid()` default
- **How to apply migrations?** Use `supabase db push` or `psql -f migration.sql`

**Summary:** FAQ for database model patterns.

## Anti-Patterns (Never Do This)

- **Missing ON DELETE**: Always specify cascade behavior for foreign keys
- **No RLS on user data**: Enable RLS on tables containing user data
- **Missing indexes**: Add indexes for frequently queried foreign keys
- **No timestamps**: Always include `created_at` and `updated_at` columns

**Summary:** Database model anti-patterns to avoid.
