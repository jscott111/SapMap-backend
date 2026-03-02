/**
 * Notification and push subscription routes
 */

import { authenticate } from '../middleware/auth.js';
import { notificationRepository } from '../storage/repositories/NotificationRepository.js';
import { pushSubscriptionRepository } from '../storage/repositories/PushSubscriptionRepository.js';

export const notificationRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * GET /api/notifications - List current user's notifications (paged)
   * Query: read (boolean, optional), operationId (optional), limit (optional), beforeId (optional)
   */
  fastify.get('/', async (request) => {
    const userId = request.user.id;
    const read = request.query.read;
    const operationId = request.query.operationId || null;
    const limit = Math.min(Number(request.query.limit) || 50, 100);
    const beforeId = request.query.beforeId || null;

    const list = await notificationRepository.findByUser(userId, {
      read: read === 'true' ? true : read === 'false' ? false : null,
      operationId,
      limit,
      beforeId,
    });
    return { notifications: list };
  });

  /**
   * PATCH /api/notifications/read-all - Mark all notifications as read (optional operationId)
   * Body: { operationId?: string }
   */
  fastify.patch('/read-all', async (request) => {
    const userId = request.user.id;
    const operationId = request.body?.operationId || null;
    const { count } = await notificationRepository.markAllRead(userId, operationId);
    return { count };
  });

  /**
   * PATCH /api/notifications/:id/read - Mark a single notification as read
   */
  fastify.patch('/:id/read', async (request, reply) => {
    const userId = request.user.id;
    const updated = await notificationRepository.markRead(request.params.id, userId);
    if (!updated) return reply.code(404).send({ error: 'Notification not found' });
    return { notification: updated };
  });

  /**
   * POST /api/notifications/subscriptions - Register or update a push subscription
   * Body: PushSubscription.toJSON() from the browser + optional userAgent
   */
  fastify.post('/subscriptions', async (request, reply) => {
    const userId = request.user.id;
    const subscription = request.body?.subscription ?? request.body;
    const userAgent = request.headers['user-agent'] || request.body?.userAgent || null;

    if (!subscription?.endpoint) {
      return reply.code(400).send({ error: 'Subscription endpoint is required' });
    }

    const sub = await pushSubscriptionRepository.upsert(userId, subscription, userAgent);
    return { subscription: sub };
  });

  /**
   * DELETE /api/notifications/subscriptions - Remove a push subscription
   * Body: { endpoint: string } or query: endpoint=
   */
  fastify.delete('/subscriptions', async (request, reply) => {
    const userId = request.user.id;
    const endpoint = request.body?.endpoint ?? request.query?.endpoint;
    if (!endpoint) {
      return reply.code(400).send({ error: 'Endpoint is required' });
    }
    const { deleted } = await pushSubscriptionRepository.deleteByEndpoint(endpoint, userId);
    return { deleted };
  });
};
