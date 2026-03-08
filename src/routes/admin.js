/**
 * Admin Routes - restricted to single admin email (johnascott14@gmail.com).
 * Read-only: list users, zones, browse collections, stats.
 */

import { authenticate, requireAdmin } from '../middleware/auth.js';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { operationMemberRepository } from '../storage/repositories/OperationMemberRepository.js';
import { getDb } from '../storage/firestore.js';
import { docToObject } from '../storage/firestore.js';
import { Collections } from '../storage/firestore.js';

const MAX_COLLECTION_LIMIT = 500;

/** Allowlist of collection names safe for read-only browse (Firestore collection ids) */
const ALLOWED_COLLECTIONS = [
  Collections.USERS,
  Collections.ZONES,
  Collections.SEASONS,
  Collections.OPERATIONS,
  Collections.SEASON_ZONES,
  Collections.COLLECTIONS,
  Collections.BOILS,
  Collections.OPERATION_MEMBERS,
  Collections.OPERATION_INVITES,
];

function sanitizeUser(doc) {
  if (!doc) return doc;
  const { passwordHash: _, ...rest } = doc;
  return rest;
}

/**
 * Returns a Set of organizationIds where at least one admin's email contains '+test'.
 * Used to exclude test operations from the admin zones map and stats.
 */
async function getOrganizationIdsWithTestAdmin(organizationIds) {
  const orgIds = [...new Set(organizationIds)].filter(Boolean);
  const result = new Set();
  for (const orgId of orgIds) {
    const members = await operationMemberRepository.findByOrganization(orgId);
    const admins = members.filter((m) => m.role === 'admin');
    for (const admin of admins) {
      const user = await userRepository.findById(admin.userId);
      if (user?.email && user.email.toLowerCase().includes('+test')) {
        result.add(orgId);
        break;
      }
    }
  }
  return result;
}

export const adminRoutes = async (fastify) => {
  const preHandlers = [authenticate, requireAdmin];

  /** GET /api/admin/users - list all users (no password hashes) */
  fastify.get('/users', { preHandler: preHandlers }, async () => {
    const users = await userRepository.findAll();
    return { users: users.map(sanitizeUser) };
  });

  /** GET /api/admin/zones - list all zones (for map + browse). Excludes zones in operations whose admin email contains '+test'. */
  fastify.get('/zones', { preHandler: preHandlers }, async () => {
    const zones = await zoneRepository.findAll();
    const orgIds = [...new Set(zones.map((z) => z.organizationId).filter(Boolean))];
    const testOrgIds = await getOrganizationIdsWithTestAdmin(orgIds);
    const filtered = zones.filter((z) => !z.organizationId || !testOrgIds.has(z.organizationId));
    return { zones: filtered };
  });

  /** GET /api/admin/collections/:collectionName?limit=100 - browse a collection (read-only) */
  fastify.get('/collections/:collectionName', { preHandler: preHandlers }, async (request, reply) => {
    const { collectionName } = request.params;
    const rawLimit = request.query?.limit;
    const limit = Math.min(
      Math.max(1, parseInt(rawLimit, 10) || 100),
      MAX_COLLECTION_LIMIT
    );

    if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
      return reply.code(400).send({
        error: 'Invalid collection',
        allowed: ALLOWED_COLLECTIONS,
      });
    }

    const snapshot = await getDb()
      .collection(collectionName)
      .limit(limit)
      .get();

    let docs = snapshot.docs.map((d) => docToObject(d));
    if (collectionName === Collections.USERS) {
      docs = docs.map(sanitizeUser);
    }

    return { documents: docs, count: docs.length };
  });

  /** GET /api/admin/stats - counts for dashboard. Excludes operations whose admin email contains '+test' from zones and operations counts. */
  fastify.get('/stats', { preHandler: preHandlers }, async () => {
    const [users, zones, orgsSnapshot] = await Promise.all([
      userRepository.findAll(),
      zoneRepository.findAll(),
      getDb().collection(Collections.OPERATIONS).get(),
    ]);
    const allOrgIds = orgsSnapshot.docs.map((d) => d.id);
    const testOrgIds = await getOrganizationIdsWithTestAdmin(allOrgIds);
    const filteredZones = zones.filter((z) => !z.organizationId || !testOrgIds.has(z.organizationId));
    const zonesWithLocation = filteredZones.filter(
      (z) => z.location && typeof z.location === 'object' && z.location.lat != null && z.location.lng != null
    );
    const filteredOperationsCount = orgsSnapshot.docs.filter((d) => !testOrgIds.has(d.id)).length;

    return {
      users: users.length,
      zones: filteredZones.length,
      zonesWithLocation: zonesWithLocation.length,
      operations: filteredOperationsCount,
    };
  });
};
