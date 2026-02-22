/**
 * Invite acceptance routes (GET public, POST requires auth)
 */

import { operationInviteRepository } from '../storage/repositories/OperationInviteRepository.js';
import { operationRepository } from '../storage/repositories/OperationRepository.js';
import { operationMemberRepository } from '../storage/repositories/OperationMemberRepository.js';
import { authenticate } from '../middleware/auth.js';

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

export const inviteRoutes = async (fastify) => {
  /** Get invite details by token (no auth; for accept page) */
  fastify.get('/:token', async (request, reply) => {
    const invite = await operationInviteRepository.findByToken(request.params.token);
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (operationInviteRepository.isExpired(invite)) {
      return reply.code(410).send({ error: 'Invite has expired' });
    }
    const org = await operationRepository.findById(invite.organizationId);
    return {
      operationName: org?.name || 'Unknown',
      role: invite.role,
      email: invite.email,
    };
  });

  /** Accept invite (auth required; user email must match invite) */
  fastify.post('/:token/accept', { preHandler: authenticate }, async (request, reply) => {
    const invite = await operationInviteRepository.findByToken(request.params.token);
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (operationInviteRepository.isExpired(invite)) {
      return reply.code(410).send({ error: 'Invite has expired' });
    }
    const userEmail = normalizeEmail(request.user.email);
    if (userEmail !== normalizeEmail(invite.email)) {
      return reply.code(403).send({ error: 'You must be logged in with the invited email to accept' });
    }
    await operationMemberRepository.addMember(
      invite.organizationId,
      request.user.id,
      invite.role,
      invite.invitedBy
    );
    await operationInviteRepository.delete(invite.id);
    const org = await operationRepository.findById(invite.organizationId);
    return { operation: org };
  });
};
