/**
 * Operation Member Repository for managing operation membership and roles
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';
import { getDb, docToObject } from '../firestore.js';

class OperationMemberRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.OPERATION_MEMBERS);
  }

  /**
   * Add a member to an operation
   */
  async addMember(organizationId, userId, role, invitedBy = null) {
    const existing = await this.getMembership(organizationId, userId);
    if (existing) return existing;
    return this.create({
      organizationId,
      userId,
      role,
      joinedAt: new Date(),
      invitedBy: invitedBy || undefined,
    });
  }

  /**
   * Get a single membership by operation and user
   */
  async getMembership(organizationId, userId) {
    const list = await this.findByConditions([
      { field: 'organizationId', value: organizationId },
      { field: 'userId', value: userId },
    ]);
    return list[0] || null;
  }

  /**
   * Get role for user in operation (or null if not a member)
   */
  async getRole(organizationId, userId) {
    const membership = await this.getMembership(organizationId, userId);
    return membership ? membership.role : null;
  }

  /**
   * Find all members of an operation
   */
  async findByOrganization(organizationId) {
    return this.findBy('organizationId', organizationId);
  }

  /**
   * Find all operation memberships for a user (returns list of { organizationId, role, ... })
   */
  async findByUser(userId) {
    return this.findBy('userId', userId);
  }

  /**
   * Remove a member from an operation
   */
  async removeMember(organizationId, userId) {
    const membership = await this.getMembership(organizationId, userId);
    if (!membership) return { success: true };
    await this.delete(membership.id);
    return { success: true };
  }

  /**
   * Update a member's role
   */
  async updateRole(organizationId, userId, role) {
    const membership = await this.getMembership(organizationId, userId);
    if (!membership) return null;
    return this.update(membership.id, { role });
  }

  /**
   * Count admins in an operation
   */
  async countAdmins(organizationId) {
    const members = await this.findByOrganization(organizationId);
    return members.filter((m) => m.role === 'admin').length;
  }
}

export const operationMemberRepository = new OperationMemberRepositoryClass();
