/**
 * Organization Invite Repository for pending invites
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

const INVITE_EXPIRY_DAYS = 7;

class OrganizationInviteRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.ORGANIZATION_INVITES);
  }

  /**
   * Create an invite with a unique token
   */
  async createInvite(organizationId, email, role, invitedBy, token) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
    return this.create({
      organizationId,
      email: email.toLowerCase(),
      role,
      token,
      invitedBy,
      expiresAt,
    });
  }

  /**
   * Find invite by token
   */
  async findByToken(token) {
    const list = await this.findBy('token', token);
    return list[0] || null;
  }

  /**
   * Find pending invite by org and email
   */
  async findByOrgAndEmail(organizationId, email) {
    const list = await this.findByConditions([
      { field: 'organizationId', value: organizationId },
      { field: 'email', value: email.toLowerCase() },
    ]);
    return list[0] || null;
  }

  /**
   * List pending invites for an organization
   */
  async listByOrganization(organizationId) {
    return this.findBy('organizationId', organizationId);
  }

  /**
   * Check if invite is expired
   */
  isExpired(invite) {
    if (!invite || !invite.expiresAt) return true;
    const expiresAt = typeof invite.expiresAt === 'string' ? new Date(invite.expiresAt) : invite.expiresAt;
    return expiresAt < new Date();
  }
}

export const organizationInviteRepository = new OrganizationInviteRepositoryClass();
