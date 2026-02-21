/**
 * Organization access helpers for role-based season and org access
 */

import { organizationMemberRepository } from '../storage/repositories/OrganizationMemberRepository.js';

const ROLE_LEVEL = { read: 1, write: 2, admin: 3 };

/**
 * Get all org memberships for a user (cached per-request in routes if needed)
 */
export async function getMembershipsForUser(userId) {
  return organizationMemberRepository.findByUser(userId);
}

/**
 * Get role level for comparison (0 if no role)
 */
function getRoleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

/**
 * Check if user has at least minRole in org (using memberships list)
 */
export function hasOrgRole(memberships, organizationId, minRole) {
  const membership = (memberships || []).find((m) => m.organizationId === organizationId);
  if (!membership) return false;
  return getRoleLevel(membership.role) >= getRoleLevel(minRole);
}

/**
 * Get user's role in org (or null)
 */
export function getOrgRole(memberships, organizationId) {
  const membership = (memberships || []).find((m) => m.organizationId === organizationId);
  return membership ? membership.role : null;
}

/**
 * Check if user can access season: owner (personal) or org member with at least read
 */
export function canAccessSeason(userId, season, memberships) {
  if (!season) return false;
  if (season.userId === userId) return true;
  if (season.organizationId && hasOrgRole(memberships, season.organizationId, 'read')) return true;
  return false;
}

/**
 * Check if user can write to season (create/update/delete): owner or org write/admin
 */
export function canWriteSeason(userId, season, memberships) {
  if (!season) return false;
  if (season.userId === userId) return true;
  if (season.organizationId && hasOrgRole(memberships, season.organizationId, 'write')) return true;
  return false;
}

/**
 * Require admin in org; throws if not
 */
export function requireOrgAdmin(memberships, organizationId) {
  if (!hasOrgRole(memberships, organizationId, 'admin')) {
    const err = new Error('Admin access required');
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Require at least minRole in org; throws if not
 */
export function requireOrgRole(memberships, organizationId, minRole) {
  if (!hasOrgRole(memberships, organizationId, minRole)) {
    const err = new Error(`Requires ${minRole} access or higher`);
    err.statusCode = 403;
    throw err;
  }
}
