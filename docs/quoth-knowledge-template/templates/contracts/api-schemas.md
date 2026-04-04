---
id: template-contracts-api-schemas
type: template
status: active
last_updated_date: "2026-01-13"
category: contracts
target_type: contract
keywords: [template, api-schemas, endpoints, routes, request, response, validation, rest]
related_stack: []
common_queries: ["API endpoints?", "Request format?", "Response format?", "API validation?"]
---

# API Schemas Template

## Purpose (What This Template Is For)

**API schema documents** define the contract between clients and servers. Use this template when documenting REST endpoints, request/response formats, and validation rules. Ensures API consistency and helps frontend-backend coordination.

- Use for: REST API documentation, endpoint contracts
- Creates: `contracts/api-schemas.md`

**Summary:** API schemas template for endpoint documentation.

## Endpoint Patterns (Routes, Methods, Paths)

**API route conventions** in this project:

```
Base URL: /api/v1

Resources:
GET    /users          # List users
GET    /users/:id      # Get single user
POST   /users          # Create user
PATCH  /users/:id      # Update user
DELETE /users/:id      # Delete user

Nested resources:
GET    /users/:id/posts    # User's posts
POST   /users/:id/posts    # Create post for user
```

Reference: `src/app/api/` for route implementations

**Summary:** REST endpoint patterns and conventions.

## Request Formats (Body, Query, Headers)

**Request format** conventions:

```typescript
// Request body (POST/PATCH)
interface CreateUserRequest {
  name: string;
  email: string;
  role?: 'admin' | 'user';
}

// Query parameters (GET)
interface ListUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
}

// Required headers
{
  "Content-Type": "application/json",
  "Authorization": "Bearer <token>"
}
```

**Summary:** Request format patterns for different HTTP methods.

## Response Formats (Success, Error, Pagination)

**Response format** conventions:

```typescript
// Success response
{
  "data": { /* resource data */ },
  "meta": { "timestamp": "2024-01-01T00:00:00Z" }
}

// List with pagination
{
  "data": [ /* array of resources */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}

// Error response (see error-handling pattern)
{
  "error": { "code": "NOT_FOUND", "message": "User not found" }
}
```

**Summary:** Response format patterns for API endpoints.

## Validation Rules (Zod, Schema)

**Request validation** using Zod:

```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).optional(),
});

// In API route
const body = CreateUserSchema.parse(await req.json());
```

Reference: `src/lib/schemas/` for shared validation schemas

**Summary:** Request validation patterns using Zod.

## Common Questions (FAQ)

- **What's the API base URL?** `/api/v1` for versioned endpoints
- **How to validate requests?** Use Zod schemas to parse and validate
- **What's the response format?** `{ data, meta }` for success, `{ error }` for errors
- **How to handle pagination?** Include `pagination` object in list responses
- **Where are routes defined?** In `src/app/api/` using Next.js App Router

**Summary:** FAQ for API schema patterns.

## Anti-Patterns (Never Do This)

- **Inconsistent naming**: Don't mix `/getUser` and `/users/:id` styles
- **Missing validation**: Always validate request bodies with schemas
- **Exposing internals**: Don't leak database IDs or internal errors to clients
- **No versioning**: Always version APIs (`/api/v1/`) for future compatibility

**Summary:** API schema anti-patterns to avoid.
