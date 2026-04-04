---
id: template-patterns-security
type: template
status: active
last_updated_date: "2026-01-13"
category: patterns
target_type: testing-pattern
keywords: [template, security, authentication, authorization, validation, sanitization, headers]
related_stack: []
common_queries: ["Security patterns?", "How to authenticate?", "Input validation?", "Auth flow?"]
---

# Security Patterns Template

## Purpose (What This Template Is For)

**Security pattern documents** define authentication, authorization, and data protection patterns. Use this template when documenting auth flows, input validation, security headers, and access control. Ensures consistent security practices across the application.

- Use for: Auth flows, input validation, security headers, access control
- Creates: `patterns/security-patterns.md`

**Summary:** Security patterns template for authentication and protection documentation.

## Authentication Flow (Login, Sessions, Tokens)

**Authentication** in this project uses [method: JWT/Session/OAuth].

```typescript
// Auth flow example
const session = await auth.signIn({
  email: user.email,
  password: user.password,
});
// Token stored in: [cookies/localStorage/memory]
```

Key points:
- **Provider**: [Supabase Auth/NextAuth/custom]
- **Token storage**: [httpOnly cookies (recommended)]
- **Session duration**: [X hours/days]

Reference: `src/lib/auth.ts`

**Summary:** Authentication flow and session management.

## Authorization (Roles, Permissions, RLS)

**Authorization** controls access using [method: RLS/RBAC/custom]:

```typescript
// Role check example
if (user.role !== 'admin') {
  throw new UnauthorizedError('Admin access required');
}
```

Roles in this project:
- `admin`: Full access
- `editor`: Read/write
- `viewer`: Read-only

Reference: `src/middleware.ts` or RLS policies in `supabase/migrations/`

**Summary:** Role-based access control patterns.

## Input Validation (Sanitization, Zod)

**Input validation** uses [Zod/Joi/custom] for all user inputs:

```typescript
// Zod validation example
const InputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
});

// Always validate before processing
const validated = InputSchema.parse(userInput);
```

Key rules:
- **Validate at boundary**: All API endpoints, form submissions
- **Never trust client**: Always re-validate server-side
- **Sanitize output**: Escape HTML when rendering user content

**Summary:** Input validation and sanitization patterns.

## Security Headers (CORS, CSP, HTTPS)

**Security headers** configured in [middleware/next.config.js]:

```typescript
// Example security headers
{
  'Content-Security-Policy': "default-src 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
}
```

Reference: `next.config.js` or `src/middleware.ts`

**Summary:** HTTP security header configuration.

## Common Questions (FAQ)

- **How do I authenticate users?** Use `auth.signIn()` from the auth provider, tokens stored in httpOnly cookies
- **How to check permissions?** Check `user.role` or use RLS policies in database
- **Where is auth configured?** In `src/lib/auth.ts` and environment variables
- **How to validate input?** Use Zod schemas, validate at API boundaries
- **What security headers are set?** CSP, X-Frame-Options, HSTS - see middleware

**Summary:** FAQ for security implementation patterns.

## Anti-Patterns (Never Do This)

- **Storing tokens in localStorage**: Use httpOnly cookies instead - prevents XSS theft
- **Trusting client-side validation**: Always re-validate server-side
- **Hardcoding secrets**: Use environment variables for all secrets
- **Missing rate limiting**: Add rate limits to auth endpoints
- **Exposing stack traces**: Return generic errors to clients, log details server-side

**Summary:** Security anti-patterns to avoid.
