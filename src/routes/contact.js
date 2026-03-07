/**
 * Contact form route – authenticated users can send a message to the app owner.
 */

import { authenticate } from '../middleware/auth.js';
import { sendContactEmail } from '../lib/email.js';

const MESSAGE_MAX_LENGTH = 2000;
const SUBJECT_MAX_LENGTH = 200;

export const contactRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST / – submit contact form (subject optional, message required).
   * Uses request.user.email and request.user.name.
   */
  fastify.post('/', async (request, reply) => {
    const { subject, message } = request.body || {};
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!msg) {
      return reply.code(400).send({ error: 'Message is required' });
    }
    if (msg.length > MESSAGE_MAX_LENGTH) {
      return reply.code(400).send({ error: `Message must be ${MESSAGE_MAX_LENGTH} characters or less` });
    }
    const subj = typeof subject === 'string' ? subject.trim() : '';
    if (subj.length > SUBJECT_MAX_LENGTH) {
      return reply.code(400).send({ error: `Subject must be ${SUBJECT_MAX_LENGTH} characters or less` });
    }

    const fromEmail = request.user?.email || 'unknown@sapmap.user';
    const fromName = request.user?.name || request.user?.email || 'SapMap user';

    const result = await sendContactEmail({
      fromEmail,
      fromName,
      subject: subj || undefined,
      message: msg,
    });

    if (!result.sent) {
      request.log?.warn?.({ contact: 'send_failed', error: result.error }, 'Contact email not sent');
      return reply.code(500).send({ error: result.error || 'Failed to send message' });
    }

    return { sent: true };
  });
};
