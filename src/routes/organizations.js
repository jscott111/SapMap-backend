/**
 * Organization and invite routes
 */

import crypto from 'crypto';
import { organizationRepository } from '../storage/repositories/OrganizationRepository.js';
import { sendInviteEmail } from '../lib/email.js';
import { organizationMemberRepository } from '../storage/repositories/OrganizationMemberRepository.js';
import { organizationInviteRepository } from '../storage/repositories/OrganizationInviteRepository.js';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { authenticate } from '../middleware/auth.js';
import {
  getMembershipsForUser,
  hasOrgRole,
  requireOrgAdmin,
} from '../lib/orgAccess.js';

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

export const organizationRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /** List orgs where current user is a member (with role) */
  fastify.get('/', async (request) => {
    const memberships = await organizationMemberRepository.findByUser(request.user.id);
    const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
    const orgs = await Promise.all(orgIds.map((id) => organizationRepository.findById(id)));
    const orgsWithRole = orgs
      .filter(Boolean)
      .map((org) => {
        const m = memberships.find((x) => x.organizationId === org.id);
        return { ...org, role: m?.role };
      });
    return { organizations: orgsWithRole };
  });

  /** Create org and add creator as admin */
  fastify.post('/', async (request, reply) => {
    const { name } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Organization name is required' });
    }
    const org = await organizationRepository.create({
      name: name.trim(),
      createdBy: request.user.id,
    });
    await organizationMemberRepository.addMember(org.id, request.user.id, 'admin', null);
    return { organization: org };
  });

  /** Get org detail + members + pending invites (any member can see; admins see invites) */
  fastify.get('/:id', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    if (!hasOrgRole(memberships, org.id, 'read')) {
      return reply.code(403).send({ error: 'Not a member of this organization' });
    }
    const members = await organizationMemberRepository.findByOrganization(org.id);
    const memberUserIds = members.map((m) => m.userId);
    const users = await Promise.all(memberUserIds.map((id) => userRepository.findById(id)));
    const userMap = Object.fromEntries(users.filter(Boolean).map((u) => [u.id, u]));
    const membersWithUsers = members.map((m) => ({
      ...m,
      email: userMap[m.userId]?.email,
      name: userMap[m.userId]?.name,
    }));
    const isAdmin = hasOrgRole(memberships, org.id, 'admin');
    let invites = [];
    if (isAdmin) {
      invites = await organizationInviteRepository.listByOrganization(org.id);
    }
    return {
      organization: org,
      members: membersWithUsers,
      invites: isAdmin ? invites : undefined,
    };
  });

  /** Update org name (admin only) */
  fastify.patch('/:id', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const { name } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Organization name is required' });
    }
    const updated = await organizationRepository.update(request.params.id, { name: name.trim() });
    return { organization: updated };
  });

  /** Create invite (admin only) */
  fastify.post('/:id/invites', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const { email, role } = request.body || {};
    const emailNorm = normalizeEmail(email);
    if (!emailNorm) return reply.code(400).send({ error: 'Email is required' });
    const validRoles = ['read', 'write', 'admin'];
    if (!validRoles.includes(role)) {
      return reply.code(400).send({ error: 'Role must be read, write, or admin' });
    }
    const members = await organizationMemberRepository.findByOrganization(org.id);
    const existingUser = await userRepository.findByEmail(emailNorm);
    if (existingUser) {
      const alreadyMember = members.some((m) => m.userId === existingUser.id);
      if (alreadyMember) {
        return reply.code(409).send({ error: 'User is already a member' });
      }
    }
    const existingInvite = await organizationInviteRepository.findByOrgAndEmail(org.id, emailNorm);
    if (existingInvite && !organizationInviteRepository.isExpired(existingInvite)) {
      return reply.code(409).send({ error: 'Pending invite already exists for this email' });
    }
    if (existingInvite) await organizationInviteRepository.delete(existingInvite.id);
    const token = crypto.randomBytes(24).toString('hex');
    const invite = await organizationInviteRepository.createInvite(
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
      await organizationInviteRepository.delete(invite.id);
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
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const invites = await organizationInviteRepository.listByOrganization(org.id);
    const valid = invites.filter((i) => !organizationInviteRepository.isExpired(i));
    return { invites: valid };
  });

  /** Cancel invite (admin only) */
  fastify.delete('/:id/invites/:inviteId', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const invite = await organizationInviteRepository.findById(request.params.inviteId);
    if (!invite || invite.organizationId !== org.id) {
      return reply.code(404).send({ error: 'Invite not found' });
    }
    await organizationInviteRepository.delete(invite.id);
    return { success: true };
  });

  /** Remove member (admin only; cannot remove last admin) */
  fastify.delete('/:id/members/:userId', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const targetUserId = request.params.userId;
    const targetMembership = await organizationMemberRepository.getMembership(org.id, targetUserId);
    if (!targetMembership) return reply.code(404).send({ error: 'Member not found' });
    if (targetMembership.role === 'admin') {
      const adminCount = await organizationMemberRepository.countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last admin' });
      }
    }
    await organizationMemberRepository.removeMember(org.id, targetUserId);
    return { success: true };
  });

  /** Update member role (admin only; cannot demote last admin) */
  fastify.patch('/:id/members/:userId', async (request, reply) => {
    const org = await organizationRepository.findById(request.params.id);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    const memberships = await getMembershipsForUser(request.user.id);
    requireOrgAdmin(memberships, org.id);
    const { role } = request.body || {};
    const validRoles = ['read', 'write', 'admin'];
    if (!validRoles.includes(role)) {
      return reply.code(400).send({ error: 'Role must be read, write, or admin' });
    }
    const targetUserId = request.params.userId;
    const targetMembership = await organizationMemberRepository.getMembership(org.id, targetUserId);
    if (!targetMembership) return reply.code(404).send({ error: 'Member not found' });
    if (targetMembership.role === 'admin' && role !== 'admin') {
      const adminCount = await organizationMemberRepository.countAdmins(org.id);
      if (adminCount <= 1) {
        return reply.code(400).send({ error: 'Cannot demote the last admin' });
      }
    }
    const updated = await organizationMemberRepository.updateRole(org.id, targetUserId, role);
    return { membership: updated };
  });
};
