# Quoth Authentication Guide

## Overview

Quoth uses multi-tenant authentication to secure your documentation and provide personalized access to your knowledge base. This guide walks you through getting started with authentication and using Quoth with Claude Desktop.

## Quick Start (5 Minutes)

### 1. Create Your Account

1. Visit [https://quoth.ai-innovation.site/auth/signup](https://quoth.ai-innovation.site/auth/signup)
2. Fill in:
   - **Username**: lowercase letters, numbers, and hyphens only (e.g., `john-doe`)
   - **Email**: your email address
   - **Password**: minimum 8 characters
3. Click "Sign Up"

**What Happens:**
- Your account is created
- A default project is auto-created: `{username}-knowledge-base`
- You're assigned as the admin of your project
- A verification email is sent to your inbox

### 2. Verify Your Email

1. Check your inbox for the verification email from Quoth
2. Click the verification link
3. You'll be redirected to the login page

### 3. Log In

1. Visit [https://quoth.ai-innovation.site/auth/login](https://quoth.ai-innovation.site/auth/login)
2. Enter your email and password
3. Click "Sign In"
4. You'll be redirected to your dashboard

### 4. Generate MCP Token

1. Navigate to [Dashboard → API Keys](https://quoth.ai-innovation.site/dashboard/api-keys)
2. Enter a label for your token (e.g., "Claude Desktop - Personal Laptop")
3. Click "Generate Token"
4. **IMPORTANT**: Copy the token immediately - it will only be shown once!

### 5. Configure Claude Desktop

1. Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add the Quoth MCP server configuration:

```json
{
  "mcpServers": {
    "quoth": {
      "url": "https://quoth.ai-innovation.site/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

3. Replace `YOUR_TOKEN_HERE` with the token you copied
4. Save the file
5. Restart Claude Desktop

### 6. Test It Out

In Claude Desktop, try:

```
Search Quoth docs for "testing patterns"
```

You should see results from your knowledge base!

## Understanding Roles

Quoth has three role types:

### Viewer (Read-Only)
- Can search and read all documents in the project
- Cannot propose documentation updates
- Perfect for team members who just need to reference docs

### Editor (Contributor)
- All viewer permissions
- Can propose documentation updates via MCP
- Proposals require admin approval before being applied
- Ideal for developers contributing to documentation

### Admin (Full Control)
- All editor permissions
- Can approve or reject documentation proposals
- Can generate and manage API keys
- Full project management access
- Default role for project owner

## User Flows

### Adding Documents to Your Knowledge Base

1. Add markdown files to your `quoth-knowledge-base/` directory
2. Run the indexing script:
   ```bash
   npx tsx scripts/index-knowledge-base.ts
   ```
3. Documents are now searchable via MCP!

### Proposing Documentation Updates

When Claude identifies outdated documentation:

1. Use the `quoth_propose_update` tool via MCP
2. Provide:
   - Document ID
   - New content
   - Evidence (code snippet or commit reference)
   - Reasoning for the change
3. Proposal is created with "pending" status
4. Admin receives notification
5. Admin reviews and approves/rejects via dashboard

### Reviewing Proposals

As an admin:

1. Go to [Dashboard → Proposals](https://quoth.ai-innovation.site/proposals)
2. Click on a proposal to view details
3. Review:
   - Original content vs. proposed content
   - Evidence provided
   - Reasoning
4. Click "Approve" or "Reject"
5. If approved:
   - Changes are committed to GitHub automatically
   - Knowledge base is re-indexed
   - Notification sent to proposer

## Multi-Project Support

### Default Project

On signup, you automatically get a project named `{username}-knowledge-base`. This is your default project and is used for:
- Your MCP tokens
- Your personal documentation
- Your team's knowledge base

### Public Demo Project

The `quoth-knowledge-base` project remains public for demonstration purposes. Anyone can:
- Search and read documents
- View proposals (but not approve/reject)
- Test the system before signing up

### Future: Multiple Projects

Coming soon - ability to create multiple projects and switch between them!

## Security Best Practices

### Token Management

1. **Never share tokens publicly** - They grant full access to your knowledge base
2. **Generate separate tokens for different devices** - Makes revocation easier
3. **Label your tokens descriptively** - "Work MacBook", "Home Desktop", etc.
4. **Rotate tokens regularly** - Tokens expire after 90 days
5. **Revoke unused tokens immediately** - Delete from the dashboard

### Password Security

1. **Use a strong, unique password** - Minimum 8 characters
2. **Enable 2FA** (coming soon)
3. **Don't reuse passwords** - Use a password manager

### Session Security

- Sessions use HTTP-only cookies (can't be accessed by JavaScript)
- Automatic session refresh
- Logout clears all session data
- Sessions expire after inactivity

## Troubleshooting

### "Unauthorized" Error in Claude Desktop

**Problem**: Claude Desktop shows "Unauthorized" when trying to use Quoth tools.

**Solutions**:
1. Verify your token is correct in the config file
2. Check if token has expired (90-day limit)
3. Generate a new token from the dashboard
4. Restart Claude Desktop after updating config

### "No Documents Found"

**Problem**: Searches return no results even though you have documents.

**Solutions**:
1. Verify documents are in the correct format (Markdown with YAML frontmatter)
2. Run the indexing script: `npx tsx scripts/index-knowledge-base.ts`
3. Check that documents are in your project's directory
4. Verify your token is using the correct project

### "Cannot Propose Update - Permission Denied"

**Problem**: Getting permission errors when trying to propose updates.

**Solutions**:
1. Check your role - viewers cannot propose updates
2. Ask a project admin to upgrade your role to "editor"
3. Verify you're using the correct token for your project

### Email Verification Not Received

**Problem**: Didn't receive verification email.

**Solutions**:
1. Check spam/junk folder
2. Wait a few minutes - email may be delayed
3. Try signing up again with the same email
4. Contact support if issue persists

## API Reference

### Environment Variables

```bash
# Required for users
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Required for server
SUPABASE_SERVICE_ROLE_KEY=eyJ...
JWT_SECRET=your-secret-here-32-bytes
GEMINIAI_API_KEY=AIza...
```

### Database Tables

Users don't need to interact with these directly, but for reference:

- `profiles` - User accounts and metadata
- `project_members` - User-project-role relationships
- `project_api_keys` - MCP authentication tokens
- `projects` - Knowledge base projects
- `documents` - Documentation content
- `document_embeddings` - Vector embeddings for search
- `document_proposals` - Update proposals

## FAQ

**Q: Can I invite team members to my project?**
A: Coming soon! For now, share your knowledge base repo and they can sign up with their own accounts.

**Q: How many tokens can I generate?**
A: Unlimited! Generate as many as you need for different devices.

**Q: What happens if my token is compromised?**
A: Immediately delete it from the dashboard. Generate a new token and update your Claude config.

**Q: Can I use Quoth without authentication?**
A: You can access the public demo project without auth. Personal projects require authentication.

**Q: How do I migrate from the old non-auth system?**
A: The public `quoth-knowledge-base` remains accessible. Your new account gets a private project for your docs.

**Q: Can I change my username?**
A: Not currently supported. Contact support if you need to change it.

**Q: What happens when my token expires?**
A: MCP tools will stop working. Generate a new token from the dashboard and update your Claude config.

## Support

- **GitHub Issues**: [github.com/your-org/quoth-mcp/issues](https://github.com)
- **Email**: support@quoth.ai-innovation.site
- **Documentation**: [https://quoth.ai-innovation.site/protocol](https://quoth.ai-innovation.site/protocol)

## Next Steps

1. ✅ Create account and verify email
2. ✅ Generate MCP token
3. ✅ Configure Claude Desktop
4. 📚 Add your team's documentation
5. 🔍 Start searching with Claude
6. 📝 Propose updates when you find outdated docs
7. 👥 Invite team members (coming soon)
