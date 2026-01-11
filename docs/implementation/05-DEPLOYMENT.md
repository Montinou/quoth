# Production Deployment Guide

## Overview

This guide covers deploying Quoth Phase 1 to production using Vercel. The system will be accessible at your production URL with full functionality.

## Pre-Deployment Checklist

### Database

- [ ] Supabase production project created
- [ ] Migration `002_proposal_system.sql` executed in production
- [ ] Knowledge base indexed in production Supabase
- [ ] Service role key copied

### GitHub

- [ ] Fine-grained token created for production repo
- [ ] Token has `Contents: Read/Write` permission
- [ ] Token expiration set (90 days)
- [ ] Webhook secret generated

### Email

- [ ] Resend account created
- [ ] Production domain verified
- [ ] DNS records (SPF, DKIM, DMARC) configured
- [ ] API key generated
- [ ] Sender email configured
- [ ] Recipient list finalized

### Gemini AI

- [ ] Production API key generated
- [ ] Rate limits understood (15 RPM)

## Step 1: Vercel Project Setup

### 1.1 Connect Repository

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Select `quoth-mcp` repository
4. Click **Import**

### 1.2 Configure Project

**Framework Preset**: Next.js
**Root Directory**: `./` (default)
**Build Command**: `npm run build`
**Output Directory**: `.next` (default)
**Install Command**: `npm install`

## Step 2: Environment Variables

### 2.1 Add Variables in Vercel

Go to **Project Settings → Environment Variables**

Add ALL variables from `.env.example`:

```bash
# Supabase (Production)
NEXT_PUBLIC_SUPABASE_URL=https://your-prod-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ[production-key]...

# Gemini AI (Production)
GEMINIAI_API_KEY=AIza[production-key]...

# GitHub (Production)
GITHUB_TOKEN=ghp_[production-token]...
GITHUB_OWNER=Montinou
GITHUB_REPO=quoth-mcp
GITHUB_BRANCH=main
GITHUB_WEBHOOK_SECRET=[generated-secret]

# Resend (Production)
RESEND_API_KEY=re_[production-key]...
RESEND_FROM_EMAIL=Quoth Guardian <quoth@yourdomain.com>
EMAIL_RECIPIENTS=admin@yourdomain.com,team@yourdomain.com

# Project
QUOTH_PROJECT_SLUG=quoth-knowledge-base
NEXT_PUBLIC_APP_URL=https://quoth.ai-innovation.site

# Phase 2
ENABLE_AUTONOMOUS_MODE=false
```

**Important**: Set environment to **Production**

### 2.2 Verify Variables

Click **Add** for each variable, then:
- Verify no typos
- Check all secrets are marked as "Secret"
- Ensure `NEXT_PUBLIC_*` variables are visible

## Step 3: Deploy

### 3.1 Initial Deployment

1. Click **Deploy** in Vercel
2. Wait for build to complete (~2-3 minutes)
3. Check build logs for errors
4. Note your deployment URL (e.g., `quoth-mcp.vercel.app`)

### 3.2 Verify Deployment

Visit: `https://your-deployment-url.vercel.app/proposals`

Should see:
- Dashboard loads correctly
- No console errors
- Empty proposals list (normal)

### 3.3 Test API

```bash
curl https://your-deployment-url.vercel.app/api/proposals
```

Should return:
```json
{"proposals":[]}
```

## Step 4: Custom Domain Setup

### 4.1 Add Domain in Vercel

1. Go to **Project Settings → Domains**
2. Click **Add Domain**
3. Enter: `quoth.ai-innovation.site`
4. Click **Add**

### 4.2 Configure DNS

Add DNS records with your provider:

**A Record** (if using apex domain):
```
Type: A
Name: quoth
Value: 76.76.21.21 (Vercel IP)
```

**CNAME Record** (if using subdomain):
```
Type: CNAME
Name: quoth
Value: cname.vercel-dns.com
```

### 4.3 Wait for Propagation

- Usually 5-15 minutes
- Check at https://dnschecker.org
- Vercel will show ✅ when ready

### 4.4 Update Environment Variable

Update in Vercel:
```bash
NEXT_PUBLIC_APP_URL=https://quoth.ai-innovation.site
```

Redeploy to apply.

## Step 5: GitHub Webhook Configuration

### 5.1 Add Webhook

1. Go to GitHub repo → **Settings → Webhooks → Add webhook**
2. Configure:
   - **Payload URL**: `https://quoth.ai-innovation.site/api/github/webhook`
   - **Content type**: `application/json`
   - **Secret**: Your `GITHUB_WEBHOOK_SECRET` from Vercel
   - **SSL verification**: Enable
   - **Events**: Just the push event
   - **Active**: ✅ Check
3. Click **Add webhook**

### 5.2 Test Webhook

1. Edit a file in `quoth-knowledge-base/`
2. Commit and push to main
3. Check webhook deliveries in GitHub
4. Verify Supabase document updated

**Success indicators**:
- ✅ Green checkmark in GitHub webhook deliveries
- Response 200
- Document updated in Supabase

## Step 6: Production Testing

### 6.1 End-to-End Test

**Test Proposal Creation**:
1. Use Claude Code with Quoth MCP
2. Call `quoth_propose_update` with test data
3. Verify proposal appears in dashboard
4. Check email notification received (if configured)

**Test Approval Workflow**:
1. Navigate to proposal in dashboard
2. Click "Approve & Commit"
3. Enter reviewer email
4. Confirm approval
5. Check GitHub for new commit
6. Verify email notification sent
7. Confirm Supabase document updated

**Test Rejection Workflow**:
1. Create another test proposal
2. Click "Reject"
3. Enter rejection reason
4. Confirm rejection
5. Verify email notification sent

### 6.2 Monitoring

**Vercel Logs**:
- Go to **Deployments → [Latest] → Logs**
- Monitor for errors
- Check function execution times

**Supabase Logs**:
- Go to Supabase Dashboard → **Logs**
- Monitor database queries
- Check for slow queries

**GitHub Deliveries**:
- Check webhook deliveries tab
- Ensure all deliveries successful

## Step 7: Security Hardening

### 7.1 Access Control (Optional)

**Option A: Vercel Authentication**
1. Enable Vercel Authentication in project settings
2. Add team members
3. Requires login to access dashboard

**Option B: IP Whitelisting**
1. Deploy behind Cloudflare
2. Configure IP whitelist
3. Only allow company IPs

**Option C: VPN**
- Access via company VPN only
- Most secure option

### 7.2 Token Rotation Schedule

Set calendar reminders:
- **GitHub Token**: Every 90 days
- **Resend API Key**: Yearly
- **Webhook Secret**: Yearly
- **Supabase Keys**: Never (rotate if compromised)

### 7.3 Monitoring Setup

**Recommended**:
- Set up Sentry for error tracking
- Configure Datadog RUM
- Enable Vercel Analytics
- Set up uptime monitoring (e.g., UptimeRobot)

## Step 8: Team Onboarding

### 8.1 Document Access

Share with team:
- Dashboard URL: `https://quoth.ai-innovation.site/proposals`
- Documentation: `/docs/implementation/`
- Support contact

### 8.2 Training

**For Reviewers**:
1. How to access dashboard
2. How to review proposals (diff viewer)
3. When to approve vs. reject
4. How to check GitHub commits

**For Developers**:
1. How to use `quoth_propose_update` MCP tool
2. What makes a good proposal
3. Dashboard features
4. Troubleshooting common issues

## Post-Deployment Checklist

- [ ] Production deployment successful
- [ ] Custom domain configured and working
- [ ] All environment variables set correctly
- [ ] GitHub webhook configured and tested
- [ ] End-to-end test passed (proposal → approval → commit)
- [ ] Email notifications working
- [ ] Webhook sync tested
- [ ] Monitoring configured
- [ ] Team onboarded
- [ ] Documentation shared

## Rollback Plan

If something goes wrong:

### Immediate Rollback

1. Go to Vercel → **Deployments**
2. Find last known good deployment
3. Click **...** → **Promote to Production**
4. Deployment reverts in ~30 seconds

### Database Rollback

**If migration causes issues**:
1. Connect to Supabase SQL Editor
2. Run rollback migration (drop tables/functions)
3. Restore from backup if needed

**Supabase Backups**:
- Automatic daily backups (Pro plan)
- Manual backup before major changes

## Maintenance

### Weekly

- [ ] Check Vercel logs for errors
- [ ] Review proposal metrics (approval rate)
- [ ] Monitor email delivery rates

### Monthly

- [ ] Review GitHub API usage
- [ ] Check Gemini AI quota
- [ ] Audit approved proposals
- [ ] Update dependencies (`npm update`)

### Quarterly

- [ ] Rotate GitHub token
- [ ] Review security settings
- [ ] Analyze system performance
- [ ] Plan Phase 2 features

## Troubleshooting Deployment Issues

### Build Fails

**Check**:
- Vercel build logs
- Node.js version compatibility
- Missing dependencies in package.json

**Fix**:
```bash
# Locally test build
npm run build

# If successful, commit and redeploy
```

### Environment Variables Not Working

**Check**:
- Variables saved in Vercel UI
- Correct environment selected (Production)
- Redeployed after adding variables

**Fix**:
- Re-add variables
- Trigger new deployment

### Webhook 401 Unauthorized

**Check**:
- Webhook secret matches Vercel env var
- Request signature format correct

**Fix**:
- Regenerate secret
- Update in both GitHub and Vercel
- Test with new webhook delivery

### Email Not Sending

**Check**:
- Resend domain verified
- API key valid
- Recipients list correct format

**Fix**:
- Test with Resend dashboard
- Check Resend logs
- Verify DNS records

## Support

For production issues:
- **Critical**: Check [06-TROUBLESHOOTING.md](./06-TROUBLESHOOTING.md)
- **Monitoring**: Vercel Dashboard Logs
- **Database**: Supabase Dashboard Logs
- **Escalation**: Contact development team

## Next Steps

After successful deployment:

1. **Monitor First Week** - Watch for unexpected issues
2. **Collect Feedback** - Ask team about usability
3. **Optimize** - Identify bottlenecks
4. **Plan Phase 2** - AI Gatekeeper features
