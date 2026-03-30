/**
 * POST   /api/v1/comms/channels/[id]/subscribe -- Subscribe agent to channel
 * DELETE /api/v1/comms/channels/[id]/subscribe -- Unsubscribe agent from channel
 */

import { createApiHandler } from '@/lib/api/handler';
import { subscribeAgent, unsubscribeAgent, getChannel } from '@/lib/comms/channels';
import { forbidden, notFound } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// POST -- Subscribe
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
  },
  async (_req, ctx, params) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can subscribe to channels.');
    }

    const channelId = params.id;

    // Verify channel exists and belongs to the same org
    const channel = await getChannel(channelId, ctx!.orgId);
    if (!channel) {
      throw notFound('Channel not found.');
    }

    await subscribeAgent(channelId, ctx!.agentId);

    return Response.json(
      { data: { channelId, agentId: ctx!.agentId, subscribed: true } },
      { status: 200 },
    );
  },
);

// ---------------------------------------------------------------------------
// DELETE -- Unsubscribe
// ---------------------------------------------------------------------------

export const DELETE = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
  },
  async (_req, ctx, params) => {
    if (!ctx!.isAgent || !ctx!.agentId) {
      throw forbidden('Only agents can unsubscribe from channels.');
    }

    const channelId = params.id;

    // Verify channel exists and belongs to the same org
    const channel = await getChannel(channelId, ctx!.orgId);
    if (!channel) {
      throw notFound('Channel not found.');
    }

    await unsubscribeAgent(channelId, ctx!.agentId);

    return Response.json(
      { data: { channelId, agentId: ctx!.agentId, subscribed: false } },
      { status: 200 },
    );
  },
);
