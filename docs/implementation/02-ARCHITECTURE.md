# System Architecture - Quoth Phase 1

## Overview

The Quoth Shadow Proposal System implements a **human-in-the-loop approval workflow** for AI-proposed documentation changes. This document explains the architecture, design decisions, and data flow.

## High-Level Architecture

```
┌─────────────────┐
│  Claude Agent   │
│  (MCP Client)   │
└────────┬────────┘
         │ quoth_propose_update
         ↓
┌─────────────────────────────────────────────────────┐
│              Supabase Database                      │
│  ┌──────────────────┐  ┌────────────────────────┐  │
│  │ document_        │  │    documents           │  │
│  │ proposals        │  │    (source of truth)   │  │
│  │ (shadow log)     │  └────────────────────────┘  │
│  └──────────────────┘                              │
└─────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────────────────┐
│          Next.js Dashboard (React)                  │
│  GET /proposals       POST /proposals/:id/approve   │
│  GET /proposals/:id   POST /proposals/:id/reject    │
└─────────────────────────────────────────────────────┘
         │
         ↓ (on approve)
┌─────────────────────────────────────────────────────┐
│            GitHub API (Octokit)                     │
│  repos.createOrUpdateFileContents()                 │
│  → Commits to quoth-knowledge-base/ directory       │
└─────────────────────────────────────────────────────┘
         │
         ├──→ Resend API (Email Notification)
         │
         └──→ GitHub Webhook
                  ↓
         ┌────────────────────────┐
         │  POST /api/github/     │
         │  webhook               │
         │  (sync back to         │
         │   Supabase)            │
         └────────────────────────┘
```

## Component Breakdown

### 1. MCP Tool Layer

**File**: `src/lib/quoth/tools.ts`

**Responsibility**: Accept proposals from AI agents

**Flow**:
1. AI agent calls `quoth_propose_update`
2. Validates document exists via `readDocument()`
3. Fetches project by slug from Supabase
4. Inserts proposal into `document_proposals` table
5. Returns success with dashboard URL

**Why**: Decouples AI interaction from storage mechanism

### 2. Database Layer (Supabase)

**File**: `supabase/migrations/002_proposal_system.sql`

**Tables**:

#### `document_proposals` (Shadow Log)
```sql
id                  uuid        PRIMARY KEY
document_id         uuid        FK to documents (nullable)
project_id          uuid        FK to projects
file_path           text        Relative path in repo
original_content    text        Snapshot for rollback
proposed_content    text        New version
reasoning           text        AI explanation
evidence_snippet    text        Code/commit reference
status              enum        pending/approved/rejected/applied/error
rejection_reason    text
commit_sha          text
commit_url          text
risk_score          int         (Phase 2)
ai_verdict          jsonb       (Phase 2)
auto_approved       boolean     (Phase 2)
created_at          timestamp
reviewed_at         timestamp
reviewed_by         text
applied_at          timestamp
```

**RPC Function**: `get_proposals_with_details()`
- Joins proposals with documents
- Filters by status
- Returns paginated results
- Optimizes dashboard queries

**Why Shadow Log**:
- Immutable audit trail
- No risk to source of truth
- Can be analyzed for AI quality metrics

### 3. API Layer

**Files**: `src/app/api/proposals/**/*.ts`

#### Endpoints

**GET /api/proposals**
- Lists all proposals with filters
- Uses RPC function for efficiency
- Supports status filtering

**GET /api/proposals/:id**
- Fetches single proposal with document details
- Includes JOINed data

**POST /api/proposals/:id/approve**
- Validates request (Zod schema)
- Checks proposal status
- Commits to GitHub
- Updates proposal with commit info
- Sends email notification
- Returns commit details

**POST /api/proposals/:id/reject**
- Validates rejection reason (min 10 chars)
- Updates proposal status
- Sends email notification

**Why REST**: Simple, stateless, easily testable

### 4. GitHub Integration

**File**: `src/lib/github.ts`

**Key Function**: `commitProposalToGitHub()`

**Process**:
1. Construct file path: `quoth-knowledge-base/{file_path}`
2. Fetch current file SHA (required for updates)
3. Base64 encode new content
4. Call GitHub API: `createOrUpdateFileContents()`
5. Return commit SHA and URL

**Error Handling**:
- 404 = New file (no SHA needed)
- Network errors = Mark proposal as 'error'
- Success = Update proposal to 'applied'

**Why Octokit**: Official GitHub client, handles auth and rate limiting

### 5. Email Integration

**File**: `src/lib/email.ts`

**Key Functions**:
- `sendApprovalNotification()` - Styled HTML email
- `sendRejectionNotification()` - Rejection alert

**Email Template Features**:
- Dark theme (matches Quoth aesthetic)
- Inline CSS (email client compatibility)
- XSS protection (`escapeHtml()`)
- Links to GitHub diff
- Proposal metadata

**Why Resend**: Simple API, React Email support, good deliverability

### 6. Dashboard UI

**Files**: `src/app/proposals/**/*.tsx`

#### Pages

**List View** (`/proposals`)
- Stats cards (total, pending, applied, rejected)
- Filter tabs
- Proposal cards with status badges
- Uses existing Quoth design system

**Detail View** (`/proposals/:id`)
- Full proposal display
- Side-by-side diff viewer
- Approve/Reject dialogs
- Email input for accountability
- Status-specific displays (commit link, rejection reason)

**Why Client-Side**: Interactive UI, real-time updates, no SSR needed for admin dashboard

### 7. Webhook Handler

**File**: `src/app/api/github/webhook/route.ts`

**Purpose**: Sync GitHub changes back to Supabase

**Process**:
1. Verify HMAC signature (security)
2. Parse webhook payload
3. Filter commits affecting `quoth-knowledge-base/`
4. For each file:
   - Fetch from GitHub raw URL
   - Parse frontmatter
   - Upsert document in Supabase
   - Delete old embeddings
   - Generate new embeddings (Gemini)
   - Rate limit: 4.2s between requests

**Why Webhook**: Real-time sync, no polling overhead

## Data Flow

### Proposal Creation

```
AI Agent
  → quoth_propose_update(doc_id, new_content, evidence, reasoning)
  → Supabase.insert('document_proposals', {...})
  → Return proposal ID + dashboard link
```

### Approval Flow

```
Human clicks "Approve" in dashboard
  → POST /api/proposals/:id/approve { reviewerEmail }
  → Update status to 'approved' in Supabase
  → commitProposalToGitHub(proposal)
     → GitHub API: createOrUpdateFileContents()
     → Return commit SHA + URL
  → Update status to 'applied' with commit info
  → sendApprovalNotification(proposal, commit)
     → Resend API: send email
  → Return success to client
```

### Rejection Flow

```
Human clicks "Reject" in dashboard
  → POST /api/proposals/:id/reject { reviewerEmail, reason }
  → Update status to 'rejected' with reason
  → sendRejectionNotification(proposal, reason)
  → Return success to client
```

### Sync Flow

```
GitHub push event
  → Webhook POST /api/github/webhook
  → Verify signature
  → For each modified file in quoth-knowledge-base/:
     → Fetch content from GitHub
     → Parse frontmatter
     → Upsert documents table
     → Delete old embeddings
     → Generate new embeddings
     → Insert new embeddings
  → Return success
```

## Design Decisions

### Why Supabase?

**Pros**:
- Built-in vector search (pgvector)
- RPC functions for complex queries
- Real-time subscriptions (future)
- Good TypeScript support

**Cons**:
- Additional service dependency
- Learning curve for team

**Decision**: Benefits outweigh costs, especially for vector search

### Why Octokit over GitHub App?

**GitHub App**:
- Better security (installation-level)
- Higher rate limits
- More complex setup

**Fine-Grained Token**:
- Simpler setup
- Sufficient for single repo
- Easier to rotate

**Decision**: Fine-grained token for Phase 1, can upgrade to App later

### Why Manual Approval (Not Auto-Approve)?

**Phase 1 Philosophy**: Human-in-the-loop
- Build trust in system
- Collect data on AI accuracy
- Safer for initial rollout

**Phase 2 Preview**: AI Gatekeeper
- Database already supports `risk_score` and `auto_approved`
- Can enable selectively per file type
- Keeps human as fallback

### Why Email over Slack/Discord?

**Email Advantages**:
- Universal (everyone has email)
- Audit trail
- Works for distributed teams
- No API rate limits

**Could Add Later**: Slack webhook for instant notifications

### Why Server-Side Rendering (SSR) Disabled?

**Dashboard Requirements**:
- Interactive UI with state management
- Real-time updates (filtering, sorting)
- Not public-facing (admin only)
- Doesn't need SEO

**Decision**: Client-side rendering with `'use client'` directive

## Security Considerations

### Authentication

**Phase 1**: No dashboard authentication
- Dashboard is internal tool
- Mitigations:
  - Deploy behind Vercel auth
  - IP whitelisting
  - VPN access only

**Phase 2**: Add NextAuth.js
- Email login
- Role-based access (admin, reviewer, viewer)

### GitHub Token

**Scope Minimization**:
- Only `Contents: Read/Write`
- No access to Actions, Issues, PRs

**Token Rotation**:
- 90-day expiration
- Calendar reminder to rotate
- Stored in Vercel (encrypted)

### Webhook Security

**HMAC Verification**:
- Every webhook validated with secret
- Timing-safe comparison prevents timing attacks
- Invalid signature = 401 Unauthorized

### XSS Protection

**Email Templates**:
- All user content escaped
- HTML special chars replaced
- Prevents malicious proposals

**Dashboard**:
- React JSX escaping (built-in)
- No `dangerouslySetInnerHTML`

## Performance Optimizations

### Database

- Indexes on `status`, `project_id`, `created_at`
- RPC function reduces N+1 queries
- Prepared statements (Supabase client)

### API

- Zod validation (fail fast)
- Fire-and-forget emails (don't block approval)
- Efficient GitHub API usage (fetch SHA first)

### Embeddings

- Rate limiting: 4.2s between chunks (15 RPM)
- Batched deletion before regeneration
- Chunks split by H2 headers (natural boundaries)

## Scalability

### Current Limitations

- Single GitHub repo
- Single project support
- No proposal queue prioritization

### Future Enhancements

- Multi-repo support (add `repo_id` column)
- Bull MQ for proposal processing
- Redis caching for dashboard data
- Horizontal scaling (Vercel handles this)

## Monitoring

### Recommended Metrics

**Business**:
- Proposals created per day
- Approval rate (%)
- Average time to review
- Top proposing agents

**Technical**:
- GitHub API response time
- Email delivery rate
- Webhook processing time
- Embedding generation errors

### Logging

**Current**:
- Console logs in development
- Vercel logs in production

**Recommended Addition**:
- Structured logging (Pino)
- Error tracking (Sentry)
- Performance monitoring (Datadog)

## Next Steps

1. **Test the System** - [04-TESTING.md](./04-TESTING.md)
2. **Deploy to Production** - [05-DEPLOYMENT.md](./05-DEPLOYMENT.md)
3. **Troubleshooting** - [06-TROUBLESHOOTING.md](./06-TROUBLESHOOTING.md)
