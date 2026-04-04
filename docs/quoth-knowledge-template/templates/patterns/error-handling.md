---
id: template-patterns-error-handling
type: template
status: active
last_updated_date: "2026-01-13"
category: patterns
target_type: testing-pattern
keywords: [template, error-handling, errors, exceptions, try-catch, boundaries, api-errors]
related_stack: []
common_queries: ["How to handle errors?", "Error handling pattern?", "API error responses?"]
---

# Error Handling Template

## Purpose (What This Template Is For)

**Error handling documents** define how errors should be caught, logged, and communicated. Use this template when documenting error types, boundaries, and API error responses. Ensures consistent error handling across the application.

- Use for: Error types, catch patterns, API error responses
- Creates: `patterns/error-handling.md`

**Summary:** Error handling template for exception documentation.

## Error Types (Custom Errors, Classification)

**Error classification** in this project:

```typescript
// Base custom error
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Specific error types
class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

class ValidationError extends AppError {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`, 'VALIDATION', 400);
  }
}
```

**Summary:** Custom error types and classification.

## Error Boundaries (Catch, Recover, Propagate)

**Error handling strategies**:

```typescript
// Service layer - catch and transform
async function getUser(id: string): Promise<User> {
  try {
    return await database.findUser(id);
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw new AppError('Database unavailable', 'DB_ERROR', 503);
    }
    throw error; // Re-throw unknown errors
  }
}

// Controller layer - final catch
app.use((error: Error, req, res, next) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});
```

**Summary:** Error boundary patterns for different layers.

## API Error Responses (Format, Codes)

**Standard API error format**:

```typescript
interface ApiErrorResponse {
  error: {
    code: string;      // Machine-readable code
    message: string;   // Human-readable message
    details?: object;  // Additional context
  };
}

// Example response
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": { "field": "email", "value": "invalid" }
  }
}
```

HTTP status codes: 400 (client), 401 (auth), 404 (not found), 500 (server)

**Summary:** API error response format and codes.

## Logging Errors (What, Where, How)

**Error logging strategy**:

```typescript
// Structured logging
logger.error('Operation failed', {
  error: error.message,
  code: error.code,
  stack: error.stack,
  context: { userId, operation },
});

// Don't log sensitive data
// BAD: logger.error('Auth failed', { password });
// GOOD: logger.error('Auth failed', { userId, attempt });
```

**Summary:** Error logging patterns and practices.

## Common Questions (FAQ)

- **How do I throw a custom error?** `throw new AppError('message', 'CODE', 400)`
- **Where do I catch errors?** At service boundaries and in global error handler
- **What status code for validation?** Use 400 for client input errors
- **How to log errors?** Use structured logging with context, avoid sensitive data
- **Should I re-throw errors?** Yes, if you can't handle them at current layer

**Summary:** FAQ for error handling patterns.

## Anti-Patterns (Never Do This)

- **Swallowing errors**: `catch (e) {}` - always log or re-throw
- **Generic messages**: "Something went wrong" - be specific about what failed
- **Logging passwords**: Never log sensitive data in error context
- **Ignoring async errors**: Always `.catch()` or use try-catch with await

**Summary:** Error handling anti-patterns to avoid.
