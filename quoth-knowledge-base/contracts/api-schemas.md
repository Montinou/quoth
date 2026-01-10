---
id: contracts-api-schemas
type: contract
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# API Schemas & Contracts

## Overview
Standard API response and request schemas using Zod for runtime validation.

## Base Response Schema
```ts
import { z } from 'zod';

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string()).optional(),
  }).optional(),
  meta: z.object({
    requestId: z.string(),
    timestamp: z.string().datetime(),
  }),
});

type ApiResponse<T> = {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string };
} | {
  success: false;
  error: { code: string; message: string; details?: Record<string, string> };
  meta: { requestId: string; timestamp: string };
};
```

## Pagination Schema
```ts
export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const PaginatedResponseSchema = z.object({
  items: z.array(z.unknown()),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
```

## Error Codes
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Missing/invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `INTERNAL_ERROR` | 500 | Server error |
