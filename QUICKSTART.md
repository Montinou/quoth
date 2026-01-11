# Quoth Phase 1 - Quick Start Guide

Get the Shadow Proposal System running in 15 minutes.

## Prerequisites

- Supabase account with existing Quoth project
- GitHub fine-grained token (Contents: Read/Write)
- Resend account with verified domain
- Google Gemini API key

## 1. Run Database Migration (2 min)

```bash
# In Supabase SQL Editor, execute:
supabase/migrations/002_proposal_system.sql
```

## 2. Configure Environment (5 min)

```bash
# Copy template
cp .env.example .env.local

# Edit .env.local with your credentials:
# - NEXT_PUBLIC_SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY
# - GEMINIAI_API_KEY
# - GITHUB_TOKEN
# - GITHUB_WEBHOOK_SECRET (generate with: openssl rand -hex 32)
# - RESEND_API_KEY
# - RESEND_FROM_EMAIL
# - EMAIL_RECIPIENTS
# - NEXT_PUBLIC_APP_URL
```

## 3. Install & Run (3 min)

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## 4. Test It Out (5 min)

### A. View Dashboard

Navigate to: http://localhost:3000/proposals

### B. Create Test Proposal (via Claude Code)

```
Use quoth_propose_update to create a proposal for "backend-unit-vitest"
with new_content "Test content", evidence_snippet "console.log('test')",
and reasoning "Testing the new proposal system"
```

### C. Review & Approve

1. Refresh dashboard - see your proposal
2. Click proposal to view details
3. Click "Approve & Commit"
4. Enter your email
5. Confirm approval
6. Check GitHub for new commit
7. Check your email for notification

## That's It!

You now have a working Quoth Shadow Proposal System.

## Next Steps

- **Production Deployment**: See [docs/implementation/05-DEPLOYMENT.md](./docs/implementation/05-DEPLOYMENT.md)
- **Full Documentation**: See [docs/implementation/README.md](./docs/implementation/README.md)
- **Architecture Deep Dive**: See [docs/implementation/02-ARCHITECTURE.md](./docs/implementation/02-ARCHITECTURE.md)

## Troubleshooting

**Dashboard shows error**: Check environment variables in `.env.local`

**Proposal not appearing**: Check Supabase migration ran successfully

**Approval fails**: Verify GitHub token has Contents: Read/Write permission

**Email not sending**: Check Resend domain is verified and API key is valid

For more help: [docs/implementation/06-TROUBLESHOOTING.md](./docs/implementation/06-TROUBLESHOOTING.md)
