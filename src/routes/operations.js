/**
 * Operation and invite routes
 */

import crypto from 'crypto';
import { operationRepository } from '../storage/repositories/OperationRepository.js';
import { sendInviteEmail } from '../lib/email.js';
import { operationMemberRepository } from '../storage/repositories/OperationMemberRepository.js';
import { operationInviteRepository } from '../storage/repositories/OperationInviteRepository.js';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { authenticate } from '../middleware/auth.js';
import {
  getMembershipsForUser,
  hasOperationRole,
  requireOperationAdmin,
} from '../lib/operationAccess.js';

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

export const operationRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /** List operations where current user is a member (with role) */
  fastify.get('/', async (request) => {
    const memberships = await operationMemberRepository.findByUser(request.user.id);
    const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
    const orgs = await Promise.all(orgIds.map((id) => operationRepository.findById(id)));
    const orgsWithRole = orgs
      .filter(Boolean)
      .map((org) => {
        const m = memberships.find((x) => x.organizationId === org.id);
        return { ...org, role: m?.role };
      });
    return { operations: orgsWithRole };
  });

  /** Create operation and add creator as admin */
  fastify.post('/', async (request, reply) => {
    const { name } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Operation name is required' });
    }
    const org = await operationRepository.create({
      name: name.trim(),
      createdBy: request.user.id,
    });
    await operationMemberRepository.addMember(org.id, request.user.id, 'admin', null);
    return { operation: org };
  });

  /** Get operation detail + members for all members; invites only for admins. */
  fastify.get('/:id', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    if (!hasOperationRole(memberships, org.id, 'read')) {
      return reply.code(403).send({ error: 'Not a member of this operation' });
    }
    const isAdmin = hasOperationRole(memberships, org.id, 'admin');
    const members = await operationMemberRepository.findByOrganization(org.id);
    const memberUserIds = members.map((m) => m.userId);
    const users = await Promise.all(memberUserIds.map((id) => userRepository.findById(id)));
    const userMap = Object.fromEntries(users.filter(Boolean).map((u) => [u.id, u]));
    const membersWithUsers = members.map((m) => ({
      ...m,
      email: userMap[m.userId]?.email,
      name: userMap[m.userId]?.name,
    }));
    let invites = [];
    if (isAdmin) {
      invites = await operationInviteRepository.listByOrganization(org.id);
    }
    return {
      operation: org,
      members: membersWithUsers,
      invites: isAdmin ? invites : undefined,
    };
  });

  /** Update operation name (admin only) */
  fastify.patch('/:id', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const { name } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Operation name is required' });
    }
    const updated = await operationRepository.update(request.params.id, { name: name.trim() });
    return { operation: updated };
  });

  /** Create invite (admin only) */
  fastify.post('/:id/invites', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const { email, role } = request.body || {};
    const emailNorm = normalizeEmail(email);
    if (!emailNorm) return reply.code(400).send({ error: 'Email is required' });
    const validRoles = ['read', 'write', 'admin'];
    if (!validRoles.includes(role)) {
      return reply.code(400).send({ error: 'Role must be read, write, or admin' });
    }
    const members = await operationMemberRepository.findByOrganization(org.id);
    const existingUser = await userRepository.findByEmail(emailNorm);
    if (existingUser) {
      const alreadyMember = members.some((m) => m.userId === existingUser.id);
      if (alreadyMember) {
        return reply.code(409).send({ error: 'User is already a member' });
      }
    }
    const existingInvite = await operationInviteRepository.findByOrgAndEmail(org.id, emailNorm);
    if (existingInvite && !operationInviteRepository.isExpired(existingInvite)) {
      return reply.code(409).send({ error: 'Pending invite already exists for this email' });
    }
    if (existingInvite) await operationInviteRepository.delete(existingInvite.id);
    const token = crypto.randomBytes(24).toString('hex');
    const invite = await operationInviteRepository.createInvite(
      org.id,
      emailNorm,
      role,
      request.user.id,
      token
    );
    const expiresAt = invite.expiresAt;

    const emailResult = await sendInviteEmail(emailNorm, org.name, role, token);
    if (!emailResult.sent) {
      request.log.warn({ emailError: emailResult.error, to: emailNorm }, 'Invite email not sent');
      await operationInviteRepository.delete(invite.id);
      return reply.code(502).send({
        error: emailResult.error || 'Failed to send invite email. The invite was not created.',
      });
    }

    return {
      invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt },
      inviteToken: token,
      emailSent: true,
    };
  });

  /** List pending invites (admin only) */
  fastify.get('/:id/invites', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const invites = await operationInviteRepository.listByOrganization(org.id);
    const valid = invites.filter((i) => !operationInviteRepository.isExpired(i));
    return { invites: valid };
  });

  /** Cancel invite (admin only) */
  fastify.delete('/:id/invites/:inviteId', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const invite = await operationInviteRepository.findById(request.params.inviteId);
    if (!invite || invite.organizationId !== org.id) {
      return reply.code(404).send({ error: 'Invite not found' });
    }
    await operationInviteRepository.delete(invite.id);
    return { success: true };
  });

  /** Leave operation (current user removes themselves; cannot leave if only admin) */
  fastify.delete('/:id/members/me', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const membership = await operationMemberRepository.getMembership(org.id, request.user.id);
    if (!membership) return reply.code(404).send({ error: 'Not a member of this operation' });
    if (membership.role === 'admin') {
      const adminCount = await operationMemberRepository.countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(400).send({
          error: 'Cannot leave: you are the only admin. Assign another admin before leaving.',
          code: 'MUST_ASSIGN_ADMIN',
        });
      }
    }
    await operationMemberRepository.removeMember(org.id, request.user.id);
    return { success: true };
  });

  /** Remove member (admin only; cannot remove last admin) */
  fastify.delete('/:id/members/:userId', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const targetUserId = request.params.userId;
    const targetMembership = await operationMemberRepository.getMembership(org.id, targetUserId);
    if (!targetMembership) return reply.code(404).send({ error: 'Member not found' });
    if (targetMembership.role === 'admin') {
      const adminCount = await operationMemberRepository.countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last admin' });
      }
    }
    await operationMemberRepository.removeMember(org.id, targetUserId);
    return { success: true };
  });

  /** Update member role (admin only; cannot demote last admin) */
  fastify.patch('/:id/members/:userId', async (request, reply) => {
    const org = await operationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Operation not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOperationAdmin(memberships, org.id);
    const { role } = request.body || {};
    const validRoles = ['read', 'write', 'admin'];
    if (!validRoles.includes(role)) {
      return reply.code(400).send({ error: 'Role must be read, write, or admin' });
    }
    const targetUserId = request.params.userId;
    const targetMembership = await operationMemberRepository.getMembership(org.id, targetUserId);
    if (!targetMembership) return reply.code(404).send({ error: 'Member not found' });
    if (targetMembership.role === 'admin' && role !== 'admin') {
      const adminCount = await operationMemberRepository.countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot demote the last admin' });
      }
    }
    const updated = await operationMemberRepository.updateRole(org.id, targetUserId, role);
    return { membership: updated };
  });
};
