/**
 * Realtime via Pusher Channels. Backend triggers events; clients subscribe via Pusher JS.
 */

import Pusher from 'pusher';

const CHANNEL_PREFIX = 'private-operation-';

let pusher = null;
let notConfiguredLogged = false;

function getPusher() {
  if (pusher) return pusher;
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) {
    if (!notConfiguredLogged) {
      notConfiguredLogged = true;
      const missing = [
        !appId && 'PUSHER_APP_ID',
        !key && 'PUSHER_KEY',
        !secret && 'PUSHER_SECRET',
        !cluster && 'PUSHER_CLUSTER',
      ].filter(Boolean);
      console.warn('[Pusher] Realtime disabled in production: set env vars:', missing.join(', '));
    }
    return null;
  }
  pusher = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
  return pusher;
}

/**
 * Trigger an event to all clients subscribed to the operation's private channel.
 * No-op if Pusher env is not set.
 * Channel name: private-operation-{operationId} (Pusher allows alphanumeric, '-', '_').
 * @param {string} operationId
 * @param {object} event - Must have .type (e.g. 'collection:created'); will be sent as payload
 */
export function trigger(operationId, event) {
  if (!operationId || !event?.type) return;
  const client = getPusher();
  if (!client) return;
  const channel = CHANNEL_PREFIX + String(operationId);
  client.trigger(channel, event.type, event).catch((err) => {
    console.error('Pusher trigger error:', err?.message);
  });
}

export { getPusher, CHANNEL_PREFIX };
