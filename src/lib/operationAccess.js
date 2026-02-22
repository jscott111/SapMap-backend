/**
 * Operation access helpers for role-based season and operation access
 */

import { operationMemberRepository } from '../storage/repositories/OperationMemberRepository.js';

const ROLE_LEVEL = { read: 1, write: 2, admin: 3 };

/**
 * Get all operation memberships for a user (cached per-request in routes if needed)
 */
export async function getMembershipsForUser(userId) {
  return operationMemberRepository.findByUser(userId);
}

/**
 * Get role level for comparison (0 if no role)
 */
function getRoleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

/**
 * Check if user has at least minRole in operation (using memberships list)
 */
export function hasOperationRole(memberships, operationId, minRole) {
  const membership = (memberships || []).find((m) => m.organizationId === operationId);
  if (!membership) return false;
  return getRoleLevel(membership.role) >= getRoleLevel(minRole);
}

/**
 * Get user's role in operation (or null)
 */
export function getOperationRole(memberships, operationId) {
  const membership = (memberships || []).find((m) => m.organizationId === operationId);
  return membership ? membership.role : null;
}

/**
 * Check if user can access season: owner (personal) or operation member with at least read
 */
export function canAccessSeason(userId, season, memberships) {
  if (!season) return false;
  if (season.userId === userId) return true;
  if (season.organizationId && hasOperationRole(memberships, season.organizationId, 'read')) return true;
  return false;
}

/**
 * Check if user can write to season (create/update/delete): owner or operation write/admin
 */
export function canWriteSeason(userId, season, memberships) {
  if (!season) return false;
  if (season.userId === userId) return true;
  if (season.organizationId && hasOperationRole(memberships, season.organizationId, 'write')) return true;
  return false;
}

/**
 * Require admin in operation; throws if not
 */
export function requireOperationAdmin(memberships, operationId) {
  if (!hasOperationRole(memberships, operationId, 'admin')) {
    const err = new Error('Admin access required');
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Require at least minRole in operation; throws if not
 */
export function requireOperationRole(memberships, operationId, minRole) {
  if (!hasOperationRole(memberships, operationId, minRole)) {
    const err = new Error(`Requires ${minRole} access or higher`);
    err.statusCode = 403;
    throw err;
  }
}
