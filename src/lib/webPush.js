/**
 * Web Push (VAPID) helper for sending browser push notifications
 */

import webpush from 'web-push';

let initialized = false;

function init() {
  if (initialized) return true;
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || 'mailto:support@sapmap.ca';

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
  return true;
}

/**
 * Send a push notification to a subscription.
 * @param {object} subscription - { endpoint, keys: { p256dh, auth } } (from PushSubscription.toJSON())
 * @param {object} payload - { title, body?, data? } will be JSON.stringify'd
 * @returns {Promise<{ success: boolean, statusCode?: number }>} - if statusCode is 410 or 404, caller should remove the subscription
 */
export async function sendPush(subscription, payload) {
  if (!init()) {
    return { success: false };
  }

  if (!subscription?.endpoint || !subscription?.keys) {
    return { success: false };
  }

  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    const result = await webpush.sendNotification(subscription, payloadStr);
    return { success: true, statusCode: result?.statusCode ?? 201 };
  } catch (err) {
    const statusCode = err?.statusCode ?? err?.response?.statusCode;
    return { success: false, statusCode };
  }
}

/**
 * Whether Web Push is configured (VAPID keys set).
 */
export function isConfigured() {
  return init();
}
