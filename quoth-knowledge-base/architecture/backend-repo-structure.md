---
id: arch-backend-structure
type: architecture
last_verified_commit: "initial"
last_updated_date: "2026-01-10"
status: active
---

# Backend Repository Structure

## Overview
Standard folder structure for backend services. Keep depth ≤ 3 levels for AI token efficiency.

## Structure
```
/src
├── /api              # API route handlers
│   ├── /v1           # Versioned endpoints
│   └── middleware.ts # Request middleware
├── /services         # Business logic layer
├── /repositories     # Data access layer
├── /models           # Database models/schemas
├── /utils            # Shared utilities
├── /config           # Environment configuration
└── index.ts          # Application entry point

/tests
├── /unit             # Unit tests (*.test.ts)
├── /integration      # Integration tests (*.int.test.ts)
└── /fixtures         # Test data fixtures
```

## Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Files | camelCase | `userService.ts` |
| Classes | PascalCase | `UserService` |
| Functions | camelCase | `createUser()` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Types/Interfaces | PascalCase | `UserDTO` |

## Layer Responsibilities
- **API**: HTTP handling, validation, response formatting
- **Services**: Business logic, orchestration, transactions
- **Repositories**: Database operations, queries
- **Models**: Schema definitions, type exports
