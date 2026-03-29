/**
 * POST /api/v1/comms/channels -- Create a channel
 * GET  /api/v1/comms/channels -- List channels for the org
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import {
  createChannel,
  listChannels,
  subscribeAgent,
} from '@/lib/comms/channels';
import { forbidden } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createChannelBody = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9._-]+$/, 'name must match ^[a-z0-9._-]+$'),
  type: z.enum(['topic', 'direct', 'project']),
  description: z.string().max(1024).optional(),
  projectId: z.string().uuid().optional(),
  subscribe: z.boolean().optional().default(false),
}).refine(
  (data) => data.type !== 'project' || !!data.projectId,
  { message: 'projectId is required for project channels', path: ['projectId'] },
);

const listChannelsQuery = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

// ---------------------------------------------------------------------------
// POST -- Create channel
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 30 },
    validate: { body: createChannelBody },
  },
  async (req, ctx) => {
    // Both human admins and agents can create channels
    if (!ctx!.isAgent && !['owner', 'admin'].includes(ctx!.role)) {
      throw forbidden('Insufficient permissions to create channels.');
    }

    const body = req.validatedBody as z.infer<typeof createChannelBody>;

    const channel = await createChannel({
      orgId: ctx!.orgId,
      name: body.name,
      type: body.type,
      description: body.description,
      projectId: body.projectId,
    });

    // Optionally subscribe the creating agent
    if (body.subscribe && ctx!.isAgent && ctx!.agentId) {
      await subscribeAgent(channel.id, ctx!.agentId);
    }

    return Response.json({ data: channel }, { status: 201 });
  },
);

// ---------------------------------------------------------------------------
// GET -- List channels
// ---------------------------------------------------------------------------

export const GET = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 120 },
    validate: { query: listChannelsQuery },
  },
  async (req, ctx) => {
    const { projectId, limit } = req.validatedQuery as z.infer<typeof listChannelsQuery>;

    const channelList = await listChannels(ctx!.orgId, projectId, limit);

    return Response.json({ data: channelList, count: channelList.length });
  },
);
