/**
 * POST /api/v1/comms/messages -- Send a message
 * GET  /api/v1/comms/messages -- Get inbox for the authenticated agent
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import { sendMessage, getInbox } from '@/lib/comms/messages';
import { forbidden, badRequest } from '@/lib/api/errors';
import type { MessageStatus } from '@/lib/comms/messages';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const sendMessageBody = z.object({
  toAgentId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  content: z.unknown().refine((val) => val !== undefined && val !== null, {
    message: 'content is required',
  }),
  messageType: z
    .enum(['message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast'])
    .optional()
    .default('message'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  replyTo: z.string().uuid().optional(),
}).refine(
  (data) => (data.toAgentId && !data.channelId) || (!data.toAgentId && data.channelId),
  { message: 'Exactly one of toAgentId or channelId must be provided' },
);

const inboxQuery = z.object({
  status: z.enum(['pending', 'delivered', 'read', 'failed', 'expired']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ---------------------------------------------------------------------------
// POST -- Send message
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { body: sendMessageBody },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can send messages.');
    }

    const body = req.validatedBody as z.infer<typeof sendMessageBody>;

    const message = await sendMessage(ctx!.agentId, ctx!.orgId, {
      toAgentId: body.toAgentId,
      channelId: body.channelId,
      content: body.content,
      messageType: body.messageType,
      priority: body.priority,
      replyTo: body.replyTo,
    });

    return Response.json({ data: message }, { status: 201 });
  },
);

// ---------------------------------------------------------------------------
// GET -- Inbox
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: inboxQuery },
  },
  async (req, ctx) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can read their inbox.');
    }

    const { status, limit, offset } = req.validatedQuery as z.infer<typeof inboxQuery>;

    const messages = await getInbox(ctx!.agentId, {
      status: status as MessageStatus | undefined,
      limit,
      offset,
    });

    return Response.json({ data: messages, count: messages.length });
  },
);
