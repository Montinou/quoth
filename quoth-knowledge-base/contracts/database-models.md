---
id: contracts-database-models
type: contract
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Database Models

## Overview
Standard database model patterns using Drizzle ORM.

## Base Model Fields
Every table should include these standard fields:

```ts
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';

// Standard timestamp fields
const timestamps = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
};

// Example table with standard fields
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  ...timestamps,
});
```

## Soft Delete Pattern
```ts
const softDelete = {
  deletedAt: timestamp('deleted_at'),
};

// Query helper
const whereNotDeleted = { deletedAt: null };
```

## Relationship Patterns

### One-to-Many
```ts
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
});
```

### Many-to-Many
```ts
export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').references(() => users.id),
  roleId: uuid('role_id').references(() => roles.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roleId] }),
}));
```

## Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Tables | snake_case (plural) | `user_roles` |
| Columns | snake_case | `created_at` |
| Indexes | `idx_table_column` | `idx_users_email` |
| Foreign Keys | `fk_table_ref` | `fk_users_org` |
