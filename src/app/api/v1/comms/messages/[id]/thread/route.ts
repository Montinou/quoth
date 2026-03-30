/**
 * GET /api/v1/comms/messages/[id]/thread -- Fetch full message thread
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import { getMessage, getThread } from '@/lib/comms/messages';
import { forbidden, notFound } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const threadQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(50),
});

// ---------------------------------------------------------------------------
// GET -- Thread
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: threadQuery },
  },
  async (req, ctx, params) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can read message threads.');
    }

    const messageId = params.id;
    const { limit } = req.validatedQuery as z.infer<typeof threadQuery>;

    // Verify the anchor message exists in the caller's org
    const anchor = await getMessage(messageId, ctx!.orgId);
    if (!anchor) {
      throw notFound('Message not found.');
    }

    // Agent must be sender or recipient of the anchor message
    const agentId = ctx!.agentId;
    const isSender = anchor.fromAgentId === agentId;
    const isRecipient = anchor.toAgentId === agentId;

    if (!isSender && !isRecipient) {
      throw forbidden('You can only read threads you are a participant in.');
    }

    const thread = await getThread(messageId, limit);

    return Response.json({ data: thread, count: thread.length });
  },
);
