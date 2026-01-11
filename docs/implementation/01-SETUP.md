# Setup Guide - Quoth Phase 1

Complete step-by-step setup instructions for the Shadow Proposal System.

## Prerequisites

- Node.js 18+ installed
- Supabase account and project
- GitHub account
- Resend account (for email notifications)
- Google AI Studio account (for Gemini embeddings)

## Step 1: Supabase Setup

### 1.1 Run Database Migration

1. Log into your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open and execute `supabase/migrations/002_proposal_system.sql`
4. Verify tables created:
   - `document_proposals`
   - Check indexes and RPC function `get_proposals_with_details`

### 1.2 Verify Existing Tables

Ensure these tables exist from the initial setup:
- `projects`
- `documents`
- `document_embeddings`

### 1.3 Get Supabase Credentials

From **Project Settings → API**:
- Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- Copy `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **Security**: Never commit `service_role` key to git!

## Step 2: GitHub Configuration

### 2.1 Create Fine-Grained Personal Access Token

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Configure:
   - **Token name**: `Quoth MCP Server`
   - **Expiration**: 90 days (set calendar reminder to rotate)
   - **Repository access**: Only select repositories → Select `quoth-mcp`
   - **Permissions**:
     - Contents: **Read and write** ✅
4. Click **Generate token**
5. Copy token → `GITHUB_TOKEN`

### 2.2 Generate Webhook Secret

```bash
openssl rand -hex 32
```

Copy output → `GITHUB_WEBHOOK_SECRET`

## Step 3: Resend Email Setup

### 3.1 Create Resend Account

1. Sign up at https://resend.com
2. Verify your email

### 3.2 Add Domain

1. Go to **Domains** → **Add Domain**
2. Enter your domain (e.g., `ai-innovation.site`)
3. Add DNS records shown (SPF, DKIM, DMARC)
4. Wait for verification (usually < 5 minutes)

### 3.3 Get API Key

1. Go to **API Keys** → **Create API Key**
2. Name: `Quoth Production`
3. Permission: Full Access
4. Copy key → `RESEND_API_KEY`

### 3.4 Configure Sender

Set these in `.env.local`:
```bash
RESEND_FROM_EMAIL=Quoth Guardian <quoth@yourdomain.com>
EMAIL_RECIPIENTS=admin@example.com,team@example.com
```

## Step 4: Google Gemini AI

### 4.1 Get API Key

1. Go to https://makersuite.google.com/app/apikey
2. Click **Get API Key**
3. Create new key or use existing
4. Copy key → `GEMINIAI_API_KEY`

## Step 5: Environment Configuration

### 5.1 Create .env.local

```bash
cp .env.example .env.local
```

### 5.2 Fill in Values

Edit `.env.local` with all credentials from steps above:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Gemini AI
GEMINIAI_API_KEY=AIzaSyxxx...

# GitHub
GITHUB_TOKEN=ghp_xxx...
GITHUB_OWNER=Montinou
GITHUB_REPO=quoth-mcp
GITHUB_BRANCH=main
GITHUB_WEBHOOK_SECRET=abc123...

# Resend
RESEND_API_KEY=re_xxx...
RESEND_FROM_EMAIL=Quoth Guardian <quoth@ai-innovation.site>
EMAIL_RECIPIENTS=your@email.com

# Project
QUOTH_PROJECT_SLUG=quoth-knowledge-base
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Phase 2 (not used yet)
ENABLE_AUTONOMOUS_MODE=false
```

## Step 6: Install Dependencies

```bash
npm install
```

This installs:
- `resend` - Email notifications (newly added)
- All existing dependencies

## Step 7: Start Development Server

```bash
npm run dev
```

Expected output:
```
  ▲ Next.js 16.1.1
  - Local:        http://localhost:3000
  - Environments: .env.local

 ✓ Compiled successfully
```

## Step 8: Verify Installation

### 8.1 Check Dashboard

Navigate to: http://localhost:3000/proposals

Should see:
- Empty proposals list (if no proposals yet)
- Filter tabs working
- No errors in browser console

### 8.2 Check API Endpoints

Test with curl:

```bash
# List proposals
curl http://localhost:3000/api/proposals

# Should return:
# {"proposals":[]}
```

### 8.3 Check MCP Tool (from Claude Code)

In Claude Code, test the tool:

```
Use quoth_propose_update to create a test proposal for document "backend-unit-vitest" with new_content "test", evidence_snippet "test", and reasoning "Testing setup"
```

Expected:
- Proposal created in Supabase
- Returns proposal ID and dashboard link
- Appears in dashboard at http://localhost:3000/proposals

## Step 9: Index Knowledge Base

If you haven't already:

```bash
npx tsx scripts/index-knowledge-base.ts
```

This ensures your documents are in Supabase for proposals to reference.

## Step 10: Configure GitHub Webhook (Local Testing)

### 10.1 Install ngrok (if testing locally)

```bash
# macOS
brew install ngrok

# Or download from https://ngrok.com
```

### 10.2 Start ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### 10.3 Configure GitHub Webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://abc123.ngrok.io/api/github/webhook`
3. **Content type**: `application/json`
4. **Secret**: Use your `GITHUB_WEBHOOK_SECRET`
5. **Events**: Select **Just the push event**
6. **Active**: ✅ Check
7. Click **Add webhook**

### 10.4 Test Webhook

1. Edit a file in `quoth-knowledge-base/` directory
2. Commit and push to main
3. Check ngrok terminal for incoming request
4. Check Supabase for updated document

## Verification Checklist

- [ ] Supabase migration ran successfully
- [ ] GitHub token has correct permissions
- [ ] Resend domain verified and sending
- [ ] Gemini API key working
- [ ] Development server starts without errors
- [ ] Dashboard accessible at `/proposals`
- [ ] API endpoints responding correctly
- [ ] MCP tool creates proposals in Supabase
- [ ] Webhook configured and tested (optional for local dev)

## Next Steps

Once setup is complete:

1. **Read Architecture** - [02-ARCHITECTURE.md](./02-ARCHITECTURE.md)
2. **Test the System** - [04-TESTING.md](./04-TESTING.md)
3. **Deploy to Production** - [05-DEPLOYMENT.md](./05-DEPLOYMENT.md)

## Common Setup Issues

See [06-TROUBLESHOOTING.md](./06-TROUBLESHOOTING.md) for solutions to:

- Supabase connection errors
- GitHub authentication failures
- Email delivery issues
- Webhook signature mismatches

## Security Notes

### Secrets Management

**Never commit these to git:**
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN`
- `RESEND_API_KEY`
- `GEMINIAI_API_KEY`
- `GITHUB_WEBHOOK_SECRET`

**For production:**
- Use Vercel environment variables
- Rotate tokens every 90 days
- Use separate tokens for dev/staging/prod
- Monitor token usage in respective dashboards

### GitHub Token Permissions

The token only needs:
- ✅ Contents: Read and Write
- ❌ Not: Actions, Issues, Pull Requests, Workflows

If you see permission errors, verify your token scope.

### Resend Domain

For production:
- Always use verified custom domain
- Never use Resend's test domain in production
- Set up DMARC for email security

## Support

For issues during setup:
- Check logs in browser console (F12)
- Check Next.js server logs in terminal
- Review Supabase logs in dashboard
- Consult troubleshooting guide
