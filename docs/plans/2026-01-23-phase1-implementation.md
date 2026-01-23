# Phase 1: Quoth Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the foundation layer - Quoth Plugin v1 with SessionStart + Stop hooks, activity logging, and basic usage analytics dashboard.

**Architecture:** Plugin runs as a Claude Code plugin with hooks that detect Quoth-connected projects and log all MCP interactions. Activity data flows from MCP server to Supabase, displayed in a new dashboard analytics view.

**Tech Stack:** Claude Code Plugin (bash hooks, JSON config), Supabase (PostgreSQL), Next.js 16, React 19, Tailwind v4

---

## Task 1: Create Activity Logging Database Schema

**Files:**
- Create: `supabase/migrations/022_activity_logging.sql`

**Step 1: Write the migration file**

```sql
-- Migration: Activity Logging for Quoth Insights
-- Purpose: Track all MCP interactions for usage analytics

BEGIN;

-- Activity logging table
CREATE TABLE IF NOT EXISTS quoth_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'read', 'propose', 'genesis', 'pattern_match')),
  query TEXT,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  patterns_matched TEXT[],
  result_count INTEGER,
  response_time_ms INTEGER,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_quoth_activity_project_id ON quoth_activity(project_id);
CREATE INDEX idx_quoth_activity_created_at ON quoth_activity(created_at DESC);
CREATE INDEX idx_quoth_activity_event_type ON quoth_activity(event_type);
CREATE INDEX idx_quoth_activity_project_created ON quoth_activity(project_id, created_at DESC);

-- RLS policies
ALTER TABLE quoth_activity ENABLE ROW LEVEL SECURITY;

-- Users can view activity for projects they have access to
CREATE POLICY "Users can view activity for their projects"
  ON quoth_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = quoth_activity.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = quoth_activity.project_id
        AND p.is_public = true
    )
  );

-- Service role can insert (MCP server uses service role)
CREATE POLICY "Service role can insert activity"
  ON quoth_activity FOR INSERT
  WITH CHECK (true);

COMMIT;
```

**Step 2: Apply migration to database**

Run:
```bash
PGPASSWORD="$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2 | tr -d '"')" \
psql "$(grep POSTGRES_URL_NON_POOLING .env | cut -d '=' -f2 | tr -d '"')" \
-f supabase/migrations/022_activity_logging.sql
```

Expected: Migration completes without errors

**Step 3: Commit**

```bash
git add supabase/migrations/022_activity_logging.sql
git commit -m "feat(db): add activity logging schema for usage analytics"
```

---

## Task 2: Create Activity Logging Service

**Files:**
- Create: `src/lib/quoth/activity.ts`

**Step 1: Write the activity logging service**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Use service role for activity logging (bypasses RLS for inserts)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type ActivityEventType = 'search' | 'read' | 'propose' | 'genesis' | 'pattern_match';

export interface ActivityLogParams {
  projectId: string;
  userId?: string;
  eventType: ActivityEventType;
  query?: string;
  documentId?: string;
  patternsMatched?: string[];
  resultCount?: number;
  responseTimeMs?: number;
  context?: Record<string, unknown>;
}

/**
 * Log an activity event to the database.
 * Non-blocking - errors are logged but don't throw.
 */
export async function logActivity(params: ActivityLogParams): Promise<void> {
  const startTime = Date.now();

  try {
    const { error } = await supabase
      .from('quoth_activity')
      .insert({
        project_id: params.projectId,
        user_id: params.userId || null,
        event_type: params.eventType,
        query: params.query || null,
        document_id: params.documentId || null,
        patterns_matched: params.patternsMatched || null,
        result_count: params.resultCount ?? null,
        response_time_ms: params.responseTimeMs ?? null,
        context: params.context || {},
      });

    if (error) {
      console.error('[Activity] Failed to log activity:', error.message);
    }
  } catch (err) {
    // Non-blocking - log and continue
    console.error('[Activity] Unexpected error logging activity:', err);
  }
}

/**
 * Helper to measure and log activity with timing.
 */
export function createActivityLogger(baseParams: Omit<ActivityLogParams, 'responseTimeMs'>) {
  const startTime = Date.now();

  return {
    complete: (overrides?: Partial<ActivityLogParams>) => {
      const responseTimeMs = Date.now() - startTime;
      logActivity({
        ...baseParams,
        ...overrides,
        responseTimeMs,
      });
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1 2>&1 | tail -5`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/quoth/activity.ts
git commit -m "feat(activity): add activity logging service"
```

---

## Task 3: Integrate Activity Logging into MCP Tools

**Files:**
- Modify: `src/lib/quoth/tools/search.ts` (or wherever quoth_search_index is implemented)
- Modify: `src/lib/quoth/tools/read.ts` (or wherever quoth_read_doc is implemented)

**Step 1: Find the MCP tool implementations**

Run: `grep -r "quoth_search_index\|searchDocuments" src/lib/quoth --include="*.ts" -l`

**Step 2: Add activity logging to search tool**

At the start of the search handler, add:
```typescript
import { createActivityLogger } from '../activity';

// Inside the handler:
const activityLogger = createActivityLogger({
  projectId: authContext.project_id,
  userId: authContext.user_id,
  eventType: 'search',
  query: args.query,
});

// After getting results:
activityLogger.complete({
  resultCount: results.length,
  patternsMatched: results.map(r => r.document_id),
});
```

**Step 3: Add activity logging to read tool**

Similar pattern for quoth_read_doc.

**Step 4: Verify build passes**

Run: `npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1 2>&1 | tail -5`

**Step 5: Commit**

```bash
git add src/lib/quoth/
git commit -m "feat(mcp): integrate activity logging into search and read tools"
```

---

## Task 4: Create Usage Analytics API Endpoint

**Files:**
- Create: `src/app/api/analytics/usage/route.ts`

**Step 1: Write the analytics API**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get project_id from query params
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const period = searchParams.get('period') || '7d'; // 7d, 30d, 90d

  if (!projectId) {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 });
  }

  // Calculate date range
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Fetch activity stats
  const { data: activity, error } = await supabase
    .from('quoth_activity')
    .select('event_type, query, created_at, result_count')
    .eq('project_id', projectId)
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Analytics] Error fetching activity:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }

  // Aggregate stats
  const stats = {
    totalQueries: activity?.length || 0,
    byEventType: {} as Record<string, number>,
    queriesPerDay: {} as Record<string, number>,
    topSearches: [] as { query: string; count: number }[],
    avgResultsPerSearch: 0,
  };

  const searchQueries: Record<string, number> = {};
  let totalResults = 0;
  let searchCount = 0;

  activity?.forEach((item) => {
    // By event type
    stats.byEventType[item.event_type] = (stats.byEventType[item.event_type] || 0) + 1;

    // By day
    const day = new Date(item.created_at).toISOString().split('T')[0];
    stats.queriesPerDay[day] = (stats.queriesPerDay[day] || 0) + 1;

    // Search queries
    if (item.event_type === 'search' && item.query) {
      searchQueries[item.query] = (searchQueries[item.query] || 0) + 1;
      if (item.result_count !== null) {
        totalResults += item.result_count;
        searchCount++;
      }
    }
  });

  // Top searches
  stats.topSearches = Object.entries(searchQueries)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Avg results
  stats.avgResultsPerSearch = searchCount > 0 ? Math.round(totalResults / searchCount) : 0;

  return NextResponse.json(stats);
}
```

**Step 2: Verify build**

Run: `npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/app/api/analytics/usage/route.ts
git commit -m "feat(api): add usage analytics endpoint"
```

---

## Task 5: Create Usage Analytics Dashboard Page

**Files:**
- Create: `src/app/(app)/dashboard/analytics/page.tsx`
- Create: `src/components/dashboard/UsageChart.tsx`

**Step 1: Create the analytics page**

```tsx
// src/app/(app)/dashboard/analytics/page.tsx
import { Suspense } from 'react';
import { UsageAnalytics } from '@/components/dashboard/UsageAnalytics';

export const metadata = {
  title: 'Usage Analytics | Quoth',
};

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage Analytics</h1>
        <p className="text-gray-400 mt-1">
          Track how your team uses Quoth documentation
        </p>
      </div>

      <Suspense fallback={<AnalyticsSkeleton />}>
        <UsageAnalytics />
      </Suspense>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-graphite rounded-lg p-6 animate-pulse">
            <div className="h-4 bg-charcoal rounded w-1/2 mb-2" />
            <div className="h-8 bg-charcoal rounded w-3/4" />
          </div>
        ))}
      </div>
      <div className="bg-graphite rounded-lg p-6 h-64 animate-pulse" />
    </div>
  );
}
```

**Step 2: Create the UsageAnalytics component**

```tsx
// src/components/dashboard/UsageAnalytics.tsx
'use client';

import { useEffect, useState } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { Search, FileText, Wand2, GitBranch } from 'lucide-react';

interface UsageStats {
  totalQueries: number;
  byEventType: Record<string, number>;
  queriesPerDay: Record<string, number>;
  topSearches: { query: string; count: number }[];
  avgResultsPerSearch: number;
}

export function UsageAnalytics() {
  const { currentProject } = useProjectContext();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProject?.id) return;

    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/analytics/usage?project_id=${currentProject.id}&period=${period}`
        );
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setStats(data);
      } catch (err) {
        setError('Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [currentProject?.id, period]);

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (error) return <div className="text-red-400">{error}</div>;
  if (!stats) return null;

  const eventIcons: Record<string, typeof Search> = {
    search: Search,
    read: FileText,
    genesis: Wand2,
    propose: GitBranch,
  };

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-2">
        {(['7d', '30d', '90d'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === p
                ? 'bg-violet-spectral text-white'
                : 'bg-graphite text-gray-400 hover:bg-charcoal'
            }`}
          >
            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Queries"
          value={stats.totalQueries}
          icon={Search}
        />
        <StatCard
          label="Searches"
          value={stats.byEventType.search || 0}
          icon={Search}
        />
        <StatCard
          label="Doc Reads"
          value={stats.byEventType.read || 0}
          icon={FileText}
        />
        <StatCard
          label="Avg Results/Search"
          value={stats.avgResultsPerSearch}
          icon={Wand2}
        />
      </div>

      {/* Top searches */}
      <div className="bg-graphite rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Top Searches</h3>
        {stats.topSearches.length === 0 ? (
          <p className="text-gray-400">No searches yet</p>
        ) : (
          <div className="space-y-2">
            {stats.topSearches.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-charcoal last:border-0"
              >
                <span className="text-gray-300 font-mono text-sm truncate max-w-md">
                  {item.query}
                </span>
                <span className="text-violet-ghost font-medium">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity timeline placeholder */}
      <div className="bg-graphite rounded-lg p-6">
        <h3 className="text-lg font-medium text-white mb-4">Activity Over Time</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">
          <p>Chart visualization coming in Phase 2</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Search;
}) {
  return (
    <div className="bg-graphite rounded-lg p-6">
      <div className="flex items-center gap-2 text-gray-400 mb-2">
        <Icon className="w-4 h-4" strokeWidth={1.5} />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}
```

**Step 3: Add analytics link to sidebar navigation**

Find the sidebar component and add a link to `/dashboard/analytics`.

**Step 4: Verify build**

Run: `npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1 2>&1 | tail -10`

**Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/analytics/page.tsx src/components/dashboard/UsageAnalytics.tsx
git commit -m "feat(dashboard): add usage analytics page"
```

---

## Task 6: Create Quoth Plugin Structure

**Files:**
- Create: `quoth-plugin/.claude-plugin/plugin.json`
- Create: `quoth-plugin/hooks/hooks.json`
- Create: `quoth-plugin/hooks/session-start.sh`
- Create: `quoth-plugin/skills/genesis/SKILL.md`
- Create: `quoth-plugin/README.md`

**Step 1: Create plugin.json**

```json
{
  "name": "quoth",
  "version": "0.1.0",
  "description": "Living documentation layer for AI-native development - auto-injects Quoth context into your Claude Code sessions",
  "author": {
    "name": "Montinou",
    "url": "https://github.com/Montinou"
  },
  "homepage": "https://quoth.ai-innovation.site",
  "repository": "https://github.com/Montinou/quoth",
  "license": "MIT",
  "keywords": [
    "documentation",
    "mcp",
    "ai",
    "claude-code",
    "source-of-truth",
    "patterns"
  ]
}
```

**Step 2: Create hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 3: Create session-start.sh**

```bash
#!/usr/bin/env bash
# Quoth Plugin - SessionStart Hook
# Detects Quoth-connected projects and injects context

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Check for Quoth configuration
QUOTH_CONFIG=""
if [ -f ".quoth/config.json" ]; then
    QUOTH_CONFIG=$(cat .quoth/config.json 2>/dev/null || echo "")
elif [ -f "quoth.config.json" ]; then
    QUOTH_CONFIG=$(cat quoth.config.json 2>/dev/null || echo "")
fi

# Check if Quoth MCP is available
QUOTH_MCP_AVAILABLE="false"
if command -v claude &> /dev/null; then
    if claude mcp list 2>/dev/null | grep -q "quoth"; then
        QUOTH_MCP_AVAILABLE="true"
    fi
fi

# Build context message
if [ -n "$QUOTH_CONFIG" ]; then
    CONTEXT_MSG="Quoth documentation is connected to this project. Use quoth_search_index before generating code to find documented patterns."
elif [ "$QUOTH_MCP_AVAILABLE" = "true" ]; then
    CONTEXT_MSG="Quoth MCP is available but no project config found. Consider running Genesis to document this codebase: Use the quoth_genesis tool."
else
    CONTEXT_MSG=""
fi

# Escape for JSON
escape_for_json() {
    local input="$1"
    printf '%s' "$input" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g; s/\r/\\r/g; s/\t/\\t/g'
}

CONTEXT_ESCAPED=$(escape_for_json "$CONTEXT_MSG")

# Output JSON
if [ -n "$CONTEXT_MSG" ]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<quoth-context>\n${CONTEXT_ESCAPED}\n</quoth-context>"
  }
}
EOF
else
    echo "{}"
fi

exit 0
```

**Step 4: Create stop.sh for the badge**

```bash
#!/usr/bin/env bash
# Quoth Plugin - Stop Hook
# Shows Quoth activity badge after response

set -euo pipefail

# For Phase 1, this is a placeholder
# In Phase 2, this will analyze the conversation and show pattern usage

echo "{}"
exit 0
```

**Step 5: Make scripts executable**

```bash
chmod +x quoth-plugin/hooks/session-start.sh
chmod +x quoth-plugin/hooks/stop.sh
```

**Step 6: Create README**

```markdown
# Quoth Plugin for Claude Code

The living documentation layer for AI-native development.

## Installation

```bash
claude plugin add quoth
```

Or add from marketplace:

```bash
claude plugin add https://github.com/Montinou/quoth
```

## What it does

- **SessionStart**: Detects Quoth-connected projects and reminds Claude to use documented patterns
- **Stop**: (Phase 2) Shows a badge summarizing which patterns were used

## Requirements

- Claude Code CLI
- Quoth MCP server connected: `claude mcp add quoth`

## Configuration

Create `.quoth/config.json` in your project:

```json
{
  "projectId": "your-project-id"
}
```

## License

MIT
```

**Step 7: Commit**

```bash
git add quoth-plugin/
git commit -m "feat(plugin): create Quoth plugin structure with SessionStart hook"
```

---

## Task 7: Update Landing Page with Genesis Demo Section

**Files:**
- Modify: `src/app/landing/page.tsx` or `src/app/page.tsx`

**Step 1: Add Genesis demo section**

Find the landing page and add a new section after the hero:

```tsx
{/* Genesis Demo Section */}
<section className="py-24 bg-charcoal">
  <div className="max-w-6xl mx-auto px-6">
    <div className="text-center mb-12">
      <h2 className="text-3xl md:text-4xl font-cinzel text-white mb-4">
        Document Your Codebase in Minutes
      </h2>
      <p className="text-gray-400 max-w-2xl mx-auto">
        Genesis analyzes your code and creates comprehensive documentation automatically.
        No more stale wikis or outdated READMEs.
      </p>
    </div>

    <div className="bg-obsidian rounded-xl p-8 border border-graphite">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-3 h-3 rounded-full bg-red-500" />
        <div className="w-3 h-3 rounded-full bg-yellow-500" />
        <div className="w-3 h-3 rounded-full bg-green-500" />
        <span className="text-gray-500 text-sm ml-2">Terminal</span>
      </div>

      <div className="font-mono text-sm space-y-2">
        <p className="text-gray-400">$ claude mcp add quoth</p>
        <p className="text-green-400">✓ Quoth MCP server added</p>
        <p className="text-gray-400 mt-4">$ Ask Claude: "Run Genesis on this project"</p>
        <p className="text-violet-ghost mt-2">
          🔮 Analyzing codebase structure...
        </p>
        <p className="text-violet-ghost">
          📝 Generating project-overview.md
        </p>
        <p className="text-violet-ghost">
          📝 Generating tech-stack.md
        </p>
        <p className="text-violet-ghost">
          📝 Generating repo-structure.md
        </p>
        <p className="text-green-400 mt-2">
          ✓ Documentation complete! 5 documents created.
        </p>
      </div>
    </div>

    <div className="text-center mt-8">
      <a
        href="https://quoth.ai-innovation.site/guide"
        className="inline-flex items-center gap-2 bg-violet-spectral hover:bg-violet-glow text-white px-6 py-3 rounded-lg font-medium transition-colors"
      >
        Get Started in 3 Minutes
      </a>
    </div>
  </div>
</section>
```

**Step 2: Verify build**

Run: `npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add src/app/
git commit -m "feat(landing): add Genesis demo section"
```

---

## Task 8: Add Analytics Link to Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx` (or wherever sidebar is defined)

**Step 1: Find the sidebar component**

Run: `grep -r "Sidebar\|sidebar" src/components --include="*.tsx" -l`

**Step 2: Add analytics link**

Add to the navigation items:
```tsx
{
  href: '/dashboard/analytics',
  label: 'Analytics',
  icon: BarChart3, // from lucide-react
}
```

**Step 3: Commit**

```bash
git add src/components/
git commit -m "feat(nav): add analytics link to sidebar"
```

---

## Task 9: Final Integration Test

**Step 1: Start dev server**

```bash
npm run dev --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1
```

**Step 2: Manual verification checklist**

- [ ] Visit `/dashboard/analytics` - page loads without errors
- [ ] Period selector buttons work (7d/30d/90d)
- [ ] Stats cards show "0" when no data (not errors)
- [ ] Landing page Genesis demo section displays correctly
- [ ] Sidebar shows Analytics link

**Step 3: Build verification**

```bash
npm run build --prefix /Users/agustinmontoya/Attorneyshare/Quoth/.worktrees/quoth-evolution-phase1
```

Expected: Build succeeds with no TypeScript errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: phase 1 integration complete"
```

---

## Summary

**Phase 1 delivers:**
1. ✅ Activity logging database schema
2. ✅ Activity logging service integrated into MCP tools
3. ✅ Usage analytics API endpoint
4. ✅ Usage analytics dashboard page
5. ✅ Quoth plugin v1 with SessionStart hook
6. ✅ Landing page Genesis demo section
7. ✅ Sidebar navigation updated

**Next steps (Phase 2):**
- PreToolUse/PostToolUse hooks for pattern injection
- Coverage view with convention-based calculation
- "Quoth Badge" in Stop hook
- Genesis auto-detection
