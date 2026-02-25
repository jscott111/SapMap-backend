/**
 * Realtime via Pusher: channel auth endpoint only.
 */

import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, hasOperationRole } from '../lib/operationAccess.js';
import { getPusher, CHANNEL_PREFIX } from '../realtime/pusherRealtime.js';

export const realtimeRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /pusher-auth
   * Body: socket_id, channel_name (Pusher JS sends these when subscribing to a private channel).
   * Verifies JWT and that user has read access to the operation for that channel; returns Pusher auth JSON.
   */
  fastify.post('/pusher-auth', async (request, reply) => {
    const pusher = getPusher();
    if (!pusher) {
      request.log.warn('Pusher auth called but Pusher not configured (missing PUSHER_* env vars)');
      return reply.code(503).send({ error: 'Realtime not configured' });
    }
    const { socket_id: socketId, channel_name: channelName } = request.body || {};
    if (!socketId || !channelName || !channelName.startsWith(CHANNEL_PREFIX)) {
      return reply.code(400).send({ error: 'Invalid socket_id or channel_name' });
    }
    const operationId = channelName.slice(CHANNEL_PREFIX.length);
    if (!operationId) {
      return reply.code(400).send({ error: 'Invalid channel' });
    }
    const memberships = await getMembershipsForUser(request.user.id);
    if (!hasOperationRole(memberships, operationId, 'read')) {
      request.log.warn({ operationId, userId: request.user.id }, 'Pusher auth: access denied to operation');
      return reply.code(403).send({ error: 'Access denied to this operation' });
    }
    const auth = pusher.authorizeChannel(socketId, channelName);
    request.log.debug({ operationId }, 'Pusher auth OK');
    return auth;
  });
};
