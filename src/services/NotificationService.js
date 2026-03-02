/**
 * Notification Service - creates notification records and dispatches in-app (Pusher) and browser push
 */

import { notificationRepository } from '../storage/repositories/NotificationRepository.js';
import { pushSubscriptionRepository } from '../storage/repositories/PushSubscriptionRepository.js';
import { operationMemberRepository } from '../storage/repositories/OperationMemberRepository.js';
import { trigger } from '../realtime/pusherRealtime.js';
import { sendPush } from '../lib/webPush.js';

/**
 * Notify a set of users (creates notification doc per user, triggers Pusher for operation channel, sends Web Push to each user's subscriptions).
 * @param {object} opts
 * @param {string[]} opts.userIds - user IDs to notify
 * @param {string} [opts.operationId] - if set, Pusher event is sent on private-operation-{operationId}
 * @param {string} opts.type - e.g. 'boil_created', 'collection_created'
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {object} [opts.data] - optional payload for deep links etc.
 */
export async function notifyUsers({ userIds, operationId, type, title, body, data }) {
  if (!userIds?.length) return;

  const payload = { type, title, body: body ?? null, data: data ?? null };

  for (const userId of userIds) {
    try {
      const notification = await notificationRepository.createForUser(userId, {
        operationId: operationId ?? null,
        type,
        title,
        body,
        data,
      });

      const pushPayload = {
        title,
        body: body ?? '',
        data: { id: notification.id, type, ...(data || {}) },
      };

      const subscriptions = await pushSubscriptionRepository.findByUser(userId);
      for (const sub of subscriptions) {
        const pushSub = { endpoint: sub.endpoint, keys: sub.keys };
        const result = await sendPush(pushSub, pushPayload);
        if (!result.success && (result.statusCode === 410 || result.statusCode === 404)) {
          await pushSubscriptionRepository.deleteByEndpoint(sub.endpoint, userId);
        }
      }
    } catch (err) {
      console.error('[NotificationService] notifyUsers error for user', userId, err?.message);
    }
  }

  if (operationId) {
    trigger(operationId, {
      type: 'notification',
      notification: payload,
    });
  }
}

/**
 * Notify all members of an operation (resolve member userIds, then notifyUsers).
 * @param {string} [opts.excludeUserId] - user ID to exclude (e.g. the actor who triggered the action)
 */
export async function notifyOperationMembers({ operationId, type, title, body, data, excludeUserId }) {
  if (!operationId) return;

  const members = await operationMemberRepository.findByOrganization(operationId);
  let userIds = [...new Set(members.map((m) => m.userId).filter(Boolean))];
  if (excludeUserId) {
    userIds = userIds.filter((id) => id !== excludeUserId);
  }
  if (userIds.length === 0) return;

  const payloadData = { ...(data || {}), ...(excludeUserId && { actorUserId: excludeUserId }) };

  await notifyUsers({
    userIds,
    operationId,
    type,
    title,
    body,
    data: payloadData,
  });
}
