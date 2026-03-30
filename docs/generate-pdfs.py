"""Generate documentation PDFs for Quoth Agent Memory and A2A Communication systems."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import os

# Colors
PRIMARY = HexColor('#1a1a2e')
ACCENT = HexColor('#16213e')
HIGHLIGHT = HexColor('#0f3460')
LIGHT_BG = HexColor('#f0f0f5')
WHITE = HexColor('#ffffff')
GRAY = HexColor('#666666')
LIGHT_GRAY = HexColor('#e0e0e0')

styles = getSampleStyleSheet()

# Custom styles
styles.add(ParagraphStyle(
    'DocTitle', parent=styles['Title'], fontSize=28, textColor=PRIMARY,
    spaceAfter=6, alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    'DocSubtitle', parent=styles['Normal'], fontSize=14, textColor=GRAY,
    alignment=TA_CENTER, spaceAfter=30
))
styles.add(ParagraphStyle(
    'SectionTitle', parent=styles['Heading1'], fontSize=18, textColor=PRIMARY,
    spaceBefore=20, spaceAfter=10, borderWidth=0, borderPadding=0
))
styles.add(ParagraphStyle(
    'SubSection', parent=styles['Heading2'], fontSize=14, textColor=HIGHLIGHT,
    spaceBefore=14, spaceAfter=8
))
styles.add(ParagraphStyle(
    'Body', parent=styles['Normal'], fontSize=10, leading=14,
    spaceAfter=8, textColor=PRIMARY
))
styles.add(ParagraphStyle(
    'CodeBlock', parent=styles['Code'], fontSize=8, leading=11,
    backColor=LIGHT_BG, borderWidth=1, borderColor=LIGHT_GRAY,
    borderPadding=8, spaceBefore=6, spaceAfter=10, leftIndent=12
))
styles.add(ParagraphStyle(
    'BulletItem', parent=styles['Normal'], fontSize=10, leading=14,
    leftIndent=20, bulletIndent=10, spaceAfter=4, textColor=PRIMARY
))
styles.add(ParagraphStyle(
    'TableHeader', parent=styles['Normal'], fontSize=9, textColor=WHITE,
    alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    'TableCell', parent=styles['Normal'], fontSize=9, textColor=PRIMARY
))


def make_table(headers, rows, col_widths=None):
    data = [[Paragraph(h, styles['TableHeader']) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), styles['TableCell']) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HIGHLIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), WHITE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ('GRID', (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


def hr():
    return HRFlowable(width="100%", thickness=1, color=LIGHT_GRAY, spaceAfter=12, spaceBefore=12)


def bullet(text):
    return Paragraph(f"<bullet>&bull;</bullet> {text}", styles['BulletItem'])


# ============================================================================
# PDF 1: AGENT MEMORY SYSTEM
# ============================================================================
def generate_memory_pdf():
    doc = SimpleDocTemplate(
        "docs/quoth-agent-memory-system.pdf", pagesize=letter,
        topMargin=0.75*inch, bottomMargin=0.75*inch,
        leftMargin=0.75*inch, rightMargin=0.75*inch
    )
    story = []

    # Title page
    story.append(Spacer(1, 100))
    story.append(Paragraph("Quoth Agent Memory System", styles['DocTitle']))
    story.append(Paragraph("Semantic Working Memory with Temporal Decay", styles['DocSubtitle']))
    story.append(Spacer(1, 20))
    story.append(Paragraph("Version 1.0 - March 2026", styles['DocSubtitle']))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Architecture, API Reference, and Implementation Guide", styles['DocSubtitle']))
    story.append(PageBreak())

    # Overview
    story.append(Paragraph("1. Overview", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "The Quoth Agent Memory System provides semantic working memory for AI agents. "
        "Each agent has its own isolated memory space with vector embeddings for semantic search, "
        "temporal decay for relevance management, and automatic consolidation from working to persistent memory.",
        styles['Body']
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Key Features:", styles['SubSection']))
    for feat in [
        "Per-agent isolated memory with namespace organization",
        "Semantic search via HNSW vector index (1536d, text-embedding-3-small)",
        "Two-tier memory: working (ephemeral) and persistent (consolidated)",
        "Temporal decay: unused memories fade, accessed ones strengthen",
        "Automatic consolidation via background worker (QStash or self-trigger)",
        "Full MCP tool integration for agent access",
        "REST API for programmatic access"
    ]:
        story.append(bullet(feat))

    # Architecture
    story.append(Spacer(1, 12))
    story.append(Paragraph("2. Architecture", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph("2.1 Database Schema", styles['SubSection']))
    story.append(Paragraph(
        "Agent memory is stored in the <b>agents.memory</b> table in Neon PostgreSQL with pgvector extension.",
        styles['Body']
    ))
    story.append(make_table(
        ['Column', 'Type', 'Purpose'],
        [
            ['id', 'UUID', 'Primary key (auto-generated)'],
            ['agent_id', 'UUID FK', 'References agents.registry'],
            ['org_id', 'UUID FK', 'Organization scope'],
            ['project_id', 'UUID FK (nullable)', 'Optional project scope'],
            ['key', 'TEXT', 'Memory identifier (unique per agent+namespace)'],
            ['value', 'TEXT', 'Memory content (string or serialized JSON)'],
            ['namespace', 'TEXT', 'Organization category (default: "default")'],
            ['embedding', 'vector(1536)', 'Semantic embedding via AI Gateway'],
            ['tier', 'TEXT', 'working or persistent'],
            ['relevance_score', 'FLOAT', 'Current relevance (0.0 - 1.0)'],
            ['access_count', 'INTEGER', 'Times accessed (search hits + direct gets)'],
            ['last_accessed_at', 'TIMESTAMPTZ', 'Last access timestamp'],
            ['tags', 'TEXT[]', 'Filterable tags array'],
            ['metadata', 'JSONB', 'Arbitrary metadata'],
            ['source', 'TEXT', 'Origin: agent, sync, consolidation, user'],
            ['expires_at', 'TIMESTAMPTZ (nullable)', 'TTL expiration'],
        ],
        col_widths=[1.2*inch, 1.2*inch, 4.5*inch]
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph("2.2 Indexes", styles['SubSection']))
    story.append(make_table(
        ['Index', 'Type', 'Columns'],
        [
            ['idx_memory_embedding', 'HNSW', 'embedding (m=16, ef_construction=200)'],
            ['idx_memory_agent_ns', 'B-tree', 'agent_id, namespace'],
            ['idx_memory_agent_tier', 'B-tree', 'agent_id, tier'],
            ['idx_memory_agent_tier_relevance', 'B-tree', 'agent_id, tier, relevance_score DESC'],
            ['idx_memory_relevance', 'B-tree', 'agent_id, relevance_score DESC'],
            ['idx_memory_tags', 'GIN', 'tags'],
            ['idx_memory_expires', 'B-tree', 'expires_at (where not null)'],
        ],
        col_widths=[2.5*inch, 1*inch, 3.4*inch]
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph("2.3 Two-Tier Memory Model", styles['SubSection']))
    story.append(Paragraph(
        "<b>Working memory</b> is ephemeral. New memories start here with relevance_score=1.0. "
        "Every hour, working memories lose 5% relevance (multiplied by 0.95). "
        "If a working memory is accessed frequently (access_count >= 3) and maintains high relevance (>= 0.5), "
        "it gets promoted to <b>persistent memory</b> during consolidation. "
        "Working memories that fall below relevance 0.05 are automatically deleted.",
        styles['Body']
    ))
    story.append(Paragraph(
        "Re-storing an existing key resets it to working tier, forcing it to re-earn persistence through use.",
        styles['Body']
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph("2.4 Relevance Scoring", styles['SubSection']))
    story.append(Paragraph(
        "Relevance is a dynamic score combining temporal decay with access frequency:",
        styles['Body']
    ))
    for item in [
        "<b>Initial store</b>: relevance_score = 1.0",
        "<b>Each access</b> (search hit or direct get): +0.03 (capped at 1.0)",
        "<b>Hourly decay</b>: relevance_score *= 0.95 (working tier only)",
        "<b>Search ranking</b>: cosine_similarity * relevance_score (combined score)",
        "<b>Cleanup threshold</b>: memories with relevance < 0.05 are deleted",
        "<b>Consolidation threshold</b>: access_count >= 3 AND relevance >= 0.5 promotes to persistent",
    ]:
        story.append(bullet(item))

    # API Reference
    story.append(PageBreak())
    story.append(Paragraph("3. API Reference", styles['SectionTitle']))
    story.append(hr())

    story.append(Paragraph("3.1 MCP Tools", styles['SubSection']))
    story.append(make_table(
        ['Tool', 'Input', 'Description'],
        [
            ['quoth_memory_store', 'key, value, namespace?, tags?, metadata?, ttlSeconds?', 'Store or update a memory with embedding'],
            ['quoth_memory_search', 'query, namespace?, tier?, limit?, threshold?', 'Semantic search across agent memories'],
            ['quoth_memory_list', 'namespace?, tier?, limit?, offset?', 'List memories by namespace/tier'],
            ['quoth_memory_forget', 'key, namespace? OR namespace, all:true', 'Delete specific memory or entire namespace'],
        ],
        col_widths=[1.8*inch, 2.2*inch, 2.9*inch]
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph("3.2 REST API", styles['SubSection']))
    story.append(make_table(
        ['Method', 'Endpoint', 'Auth', 'Rate Limit', 'Description'],
        [
            ['POST', '/api/v1/memory', 'Agent', '60 rpm', 'Store memory'],
            ['GET', '/api/v1/memory', 'Agent', '60 rpm', 'List memories'],
            ['POST', '/api/v1/memory/search', 'Agent', '120 rpm', 'Semantic search'],
            ['GET', '/api/v1/memory/{key}', 'Agent', '60 rpm', 'Get by key'],
            ['DELETE', '/api/v1/memory/{key}', 'Agent', '60 rpm', 'Delete by key'],
        ],
        col_widths=[0.7*inch, 1.8*inch, 0.7*inch, 0.9*inch, 2.8*inch]
    ))

    # Background Worker
    story.append(Spacer(1, 12))
    story.append(Paragraph("4. Background Worker", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "The consolidation worker runs hourly (via QStash or self-trigger) and performs 5 tasks:",
        styles['Body']
    ))
    story.append(make_table(
        ['Task', 'SQL Function', 'Effect'],
        [
            ['1. Temporal Decay', 'agents.apply_memory_decay()', 'Working memories * 0.95 relevance'],
            ['2. Consolidate', 'agents.consolidate_memory()', 'Promote working -> persistent (access>=3, rel>=0.5)'],
            ['3. Cleanup', 'agents.cleanup_memory()', 'Delete expired + low relevance (<0.05)'],
            ['4. Drift Detection', 'Custom query', 'Flag docs with stale memory references'],
            ['5. Auto-fail Tasks', 'comms.auto_fail_overdue_tasks()', 'Fail tasks past deadline'],
        ],
        col_widths=[1.5*inch, 2.3*inch, 3.1*inch]
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "<b>Self-trigger (free tier)</b>: maybeRunConsolidation() is called at the end of every search. "
        "It checks a Redis timestamp and runs consolidation if >1 hour since last run. "
        "Distributed lock prevents concurrent runs.",
        styles['Body']
    ))

    # Embedding
    story.append(Spacer(1, 12))
    story.append(Paragraph("5. Embedding Pipeline", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "Every memory store generates a 1536-dimensional vector embedding via the Vercel AI Gateway "
        "using OpenAI's text-embedding-3-small model. This enables semantic search across agent memories.",
        styles['Body']
    ))
    for item in [
        "<b>Model</b>: openai/text-embedding-3-small (via Vercel AI Gateway)",
        "<b>Dimensions</b>: 1536",
        "<b>Index</b>: HNSW (m=16, ef_construction=200, cosine distance)",
        "<b>Search</b>: agents.search_memory() SQL function with threshold filtering",
        "<b>Cost</b>: $0.02 per million tokens",
        "<b>Batch</b>: embedMany() supports up to 2048 inputs per call",
    ]:
        story.append(bullet(item))

    # Scoping
    story.append(Spacer(1, 12))
    story.append(Paragraph("6. Scoping and Isolation", styles['SectionTitle']))
    story.append(hr())
    story.append(make_table(
        ['Scope', 'Enforced By', 'Description'],
        [
            ['Agent', 'agent_id FK + auth context', 'Each agent has isolated memory space'],
            ['Organization', 'org_id FK', 'All queries scoped to authenticated org'],
            ['Project', 'project_id FK (optional)', 'Optional project-level scoping'],
            ['Namespace', 'UNIQUE(agent_id, namespace, key)', 'Logical grouping within agent memory'],
        ],
        col_widths=[1.2*inch, 2*inch, 3.7*inch]
    ))

    doc.build(story)
    print("Generated: docs/quoth-agent-memory-system.pdf")


# ============================================================================
# PDF 2: A2A COMMUNICATION BUS
# ============================================================================
def generate_a2a_pdf():
    doc = SimpleDocTemplate(
        "docs/quoth-a2a-communication-bus.pdf", pagesize=letter,
        topMargin=0.75*inch, bottomMargin=0.75*inch,
        leftMargin=0.75*inch, rightMargin=0.75*inch
    )
    story = []

    # Title page
    story.append(Spacer(1, 100))
    story.append(Paragraph("Quoth A2A Communication Bus", styles['DocTitle']))
    story.append(Paragraph("Agent-to-Agent Messaging, Tasks, and Webhooks", styles['DocSubtitle']))
    story.append(Spacer(1, 20))
    story.append(Paragraph("Version 1.0 - March 2026", styles['DocSubtitle']))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Protocol, Security, and API Reference", styles['DocSubtitle']))
    story.append(PageBreak())

    # Overview
    story.append(Paragraph("1. Overview", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "The Quoth A2A Communication Bus enables AI agents to communicate with each other through "
        "direct messages, broadcast channels, task assignments, and webhook notifications. "
        "All communication is scoped to organizations with optional project-level isolation.",
        styles['Body']
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Communication Patterns:", styles['SubSection']))
    story.append(make_table(
        ['Pattern', 'Mechanism', 'Use Case'],
        [
            ['Direct Message', 'Agent A -> Agent B (toAgentId)', '1:1 requests, responses, notifications'],
            ['Channel Broadcast', 'Agent A -> Channel X (all subscribers)', 'Announcements, events, pub/sub'],
            ['Task Assignment', 'Agent A creates task for Agent B', 'Work delegation, async processing'],
            ['Webhook', 'HTTP POST to registered URL', 'External integrations, event-driven'],
            ['Thread', 'replyTo chain on messages', 'Conversations, follow-ups'],
        ],
        col_widths=[1.3*inch, 2.5*inch, 3.1*inch]
    ))

    # Messaging
    story.append(Spacer(1, 12))
    story.append(Paragraph("2. Messaging", styles['SectionTitle']))
    story.append(hr())

    story.append(Paragraph("2.1 Direct Messages", styles['SubSection']))
    story.append(Paragraph(
        "An agent sends a message to another agent by specifying <b>toAgentId</b>. "
        "The DB constraint ensures either toAgentId OR channelId is set, never both. "
        "A NOTIFY trigger fires on insert, pushing to the <b>agent_inbox_{agentId}</b> PostgreSQL channel.",
        styles['Body']
    ))

    story.append(Paragraph("2.2 Channel Broadcast", styles['SubSection']))
    story.append(Paragraph(
        "Agents subscribe to channels. When a message is sent to a channel (channelId set, toAgentId null), "
        "all subscribed agents see it on their next inbox poll. NOTIFY fires on <b>channel_{channelId}</b>.",
        styles['Body']
    ))
    story.append(make_table(
        ['Channel Type', 'Scope', 'Use Case'],
        [
            ['topic', 'Org-wide', 'Broadcast events, alerts, system announcements'],
            ['project', 'Project-scoped', 'Project-specific coordination (requires agent_projects membership)'],
            ['direct', '1:1', 'Private conversation channel between two agents'],
        ],
        col_widths=[1.2*inch, 1.3*inch, 4.4*inch]
    ))

    story.append(Paragraph("2.3 Message Lifecycle", styles['SubSection']))
    story.append(make_table(
        ['Status', 'Meaning', 'Transition'],
        [
            ['pending', 'Message created, not yet seen by recipient', 'On insert'],
            ['delivered', 'Recipient fetched inbox containing this message', 'On inbox read'],
            ['read', 'Recipient explicitly marked as read', 'markAsRead()'],
            ['failed', 'Delivery failed (webhook or processing error)', 'On error'],
            ['expired', 'TTL exceeded (default: 7 days)', 'Cleanup cron'],
        ],
        col_widths=[1*inch, 3*inch, 2.9*inch]
    ))

    story.append(Paragraph("2.4 Message Types", styles['SubSection']))
    for mtype in [
        "<b>message</b>: General text/data message",
        "<b>task</b>: Task assignment notification",
        "<b>result</b>: Task completion result",
        "<b>alert</b>: High-priority notification",
        "<b>knowledge</b>: Shared learning/pattern",
        "<b>curator</b>: Curation action",
        "<b>broadcast</b>: Channel-wide announcement",
    ]:
        story.append(bullet(mtype))

    # Threading
    story.append(Spacer(1, 12))
    story.append(Paragraph("2.5 Threading", styles['SubSection']))
    story.append(Paragraph(
        "Any message can include a <b>replyTo</b> field pointing to another message's ID. "
        "The getThread() function uses a recursive CTE to walk the full conversation chain. "
        "For direct messages, replies go back to the original sender. "
        "For channel messages, replies post to the same channel.",
        styles['Body']
    ))

    # Task Queue
    story.append(PageBreak())
    story.append(Paragraph("3. Task Queue", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "The task queue enables structured work delegation between agents. "
        "Tasks have priority (1-10), optional deadlines, and a strict status lifecycle.",
        styles['Body']
    ))

    story.append(Paragraph("3.1 Task Lifecycle", styles['SubSection']))
    story.append(make_table(
        ['Status', 'Who Can Transition', 'Next States'],
        [
            ['pending', 'System (on create)', 'in_progress (claim), cancelled, failed (auto)'],
            ['in_progress', 'Assigned agent (claim)', 'done (complete), failed (fail/auto)'],
            ['done', 'Assigned agent', 'Terminal'],
            ['failed', 'Assigned agent or auto-fail', 'pending (reassign)'],
            ['cancelled', 'Admin', 'Terminal'],
        ],
        col_widths=[1.2*inch, 2.3*inch, 3.4*inch]
    ))

    story.append(Paragraph("3.2 Deadlock Recovery", styles['SubSection']))
    for item in [
        "<b>Auto-fail</b>: Consolidation cron checks tasks with deadline < now() AND status in_progress, marks as failed",
        "<b>Reassignment</b>: Admin or task creator can reassign stuck tasks via PUT /api/v1/comms/tasks",
        "<b>MCP tool</b>: quoth_agent_task_reassign (admin/owner only)",
    ]:
        story.append(bullet(item))

    # Security
    story.append(Spacer(1, 12))
    story.append(Paragraph("4. Security", styles['SectionTitle']))
    story.append(hr())

    story.append(Paragraph("4.1 Authentication", styles['SubSection']))
    story.append(Paragraph(
        "All comms endpoints require agent authentication via Clerk JWT or agent API key (qth_ prefix). "
        "Agent identity is extracted from auth context, not from request body - preventing spoofing.",
        styles['Body']
    ))

    story.append(Paragraph("4.2 Isolation", styles['SubSection']))
    story.append(make_table(
        ['Boundary', 'Enforcement', 'Effect'],
        [
            ['Organization', 'org_id on all tables + auth context', 'Agents can only communicate within their org'],
            ['Project', 'verifyProjectAccess() check', 'Project-scoped channels/tasks require agent_projects membership'],
            ['Agent inbox', 'WHERE to_agent_id = authenticated agent', 'Agent can only read own inbox'],
            ['Spoofing', 'from_agent_id from auth context', 'Cannot send as another agent'],
        ],
        col_widths=[1.2*inch, 2.3*inch, 3.4*inch]
    ))

    story.append(Paragraph("4.3 Rate Limiting", styles['SubSection']))
    story.append(make_table(
        ['Operation', 'Limit', 'Scope'],
        [
            ['Send message', '120 rpm', 'Per agent'],
            ['Read inbox', '120 rpm', 'Per agent'],
            ['Create channel', '30 rpm', 'Per agent'],
            ['Create task', '60 rpm', 'Per agent'],
            ['Update task', '60 rpm', 'Per agent'],
            ['Subscribe/unsubscribe', '30 rpm', 'Per agent'],
        ],
        col_widths=[2*inch, 1.5*inch, 3.4*inch]
    ))

    # Webhooks
    story.append(Spacer(1, 12))
    story.append(Paragraph("5. Webhooks", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "Agents can register webhook URLs to receive HTTP POST notifications for specific events. "
        "Payloads are signed with HMAC-SHA256 for verification.",
        styles['Body']
    ))

    story.append(Paragraph("5.1 Delivery", styles['SubSection']))
    for item in [
        "<b>Signature</b>: X-Quoth-Signature: sha256={hmac_hex} (timing-safe comparison)",
        "<b>Headers</b>: X-Quoth-Event, X-Quoth-Delivery, Content-Type: application/json",
        "<b>Timeout</b>: 10 seconds per delivery attempt",
        "<b>Retries</b>: 5 attempts with exponential backoff (1s, 5s, 25s, 125s, 625s)",
        "<b>Retry cron</b>: QStash every 5 minutes queries retrying deliveries",
        "<b>Failure</b>: After 15 consecutive failures, subscription marked as failed",
    ]:
        story.append(bullet(item))

    # API Reference
    story.append(PageBreak())
    story.append(Paragraph("6. API Reference", styles['SectionTitle']))
    story.append(hr())

    story.append(Paragraph("6.1 MCP Tools", styles['SubSection']))
    story.append(make_table(
        ['Tool', 'Description'],
        [
            ['quoth_agent_register', 'Register new agent in org'],
            ['quoth_agent_list', 'List agents by org + status'],
            ['quoth_agent_assign', 'Assign agent to project'],
            ['quoth_agent_send_message', 'Send direct or channel message'],
            ['quoth_agent_inbox', 'Read inbox (marks as delivered)'],
            ['quoth_agent_tasks', 'List/claim/complete tasks'],
            ['quoth_agent_task_reassign', 'Reassign task (admin only)'],
        ],
        col_widths=[2.5*inch, 4.4*inch]
    ))

    story.append(Spacer(1, 12))
    story.append(Paragraph("6.2 REST API", styles['SubSection']))
    story.append(make_table(
        ['Method', 'Endpoint', 'Description'],
        [
            ['POST', '/api/v1/comms/messages', 'Send message'],
            ['GET', '/api/v1/comms/messages', 'Read inbox'],
            ['GET', '/api/v1/comms/messages/{id}/thread', 'Get full thread'],
            ['POST', '/api/v1/comms/channels', 'Create channel'],
            ['GET', '/api/v1/comms/channels', 'List channels'],
            ['POST', '/api/v1/comms/channels/{id}/subscribe', 'Subscribe to channel'],
            ['DELETE', '/api/v1/comms/channels/{id}/subscribe', 'Unsubscribe'],
            ['POST', '/api/v1/comms/tasks', 'Create task'],
            ['GET', '/api/v1/comms/tasks', 'List tasks'],
            ['PATCH', '/api/v1/comms/tasks', 'Claim/complete/fail task'],
            ['PUT', '/api/v1/comms/tasks', 'Reassign task'],
        ],
        col_widths=[0.8*inch, 3*inch, 3.1*inch]
    ))

    # NOTIFY
    story.append(Spacer(1, 12))
    story.append(Paragraph("7. PostgreSQL NOTIFY Channels", styles['SectionTitle']))
    story.append(hr())
    story.append(Paragraph(
        "The database fires NOTIFY events on message and task inserts via triggers. "
        "These are available for real-time consumers (future WebSocket relay).",
        styles['Body']
    ))
    story.append(make_table(
        ['Event', 'Channel Pattern', 'Payload'],
        [
            ['Direct message', 'agent_inbox_{agentId}', '{message_id, from_agent_id, message_type, priority}'],
            ['Channel message', 'channel_{channelId}', '{message_id, from_agent_id, channel_id, message_type}'],
            ['Org monitor', 'org_messages_{orgId}', '{message_id, from/to agents, channel, type}'],
            ['Task assigned', 'agent_tasks_{agentId}', '{task_id, title, priority, created_by}'],
        ],
        col_widths=[1.2*inch, 2*inch, 3.7*inch]
    ))

    doc.build(story)
    print("Generated: docs/quoth-a2a-communication-bus.pdf")


if __name__ == '__main__':
    os.makedirs('docs', exist_ok=True)
    generate_memory_pdf()
    generate_a2a_pdf()
    print("Done! Both PDFs generated in docs/")
