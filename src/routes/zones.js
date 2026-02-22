/**
 * Zone Routes (Sugar Bush) - org-scoped
 */

import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { seasonZoneRepository } from '../storage/repositories/SeasonZoneRepository.js';
import { getZonesForSeason } from '../services/StatsService.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, canAccessSeason, canWriteSeason, hasOperationRole } from '../lib/operationAccess.js';

async function canWriteZone(zone, userId, memberships) {
  if (!zone) return false;
  const orgId = zone.organizationId;
  if (orgId) return hasOperationRole(memberships, orgId, 'write');
  if (zone.seasonId) {
    const season = await seasonRepository.findById(zone.seasonId);
    return season && canWriteSeason(userId, season, memberships);
  }
  return zone.userId === userId;
}

function parseLocation(location) {
  if (location == null) return null;
  if (typeof location !== 'object') return undefined;
  const lat = location.lat != null ? Number(location.lat) : NaN;
  const lng = location.lng != null ? Number(location.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

export const zoneRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request) => {
    request.memberships = await getMembershipsForUser(request.user.id);
  });

  /**
   * Get all zones for an operation (organizationId in query) or active season's operation.
   * Optional seasonId: when present, return only zones included in that season with resolved tapCount.
   */
  fastify.get('/', async (request, reply) => {
    const { organizationId: queryOrgId, seasonId } = request.query;
    let organizationId = queryOrgId;

    if (!organizationId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) return { zones: [] };
      organizationId = activeSeason.organizationId;
      if (!organizationId) return { zones: [] };
    }

    if (!hasOperationRole(request.memberships, organizationId, 'read')) {
      return reply.code(403).send({ error: 'Access denied to this operation' });
    }

    if (seasonId) {
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.organizationId !== organizationId) {
        return reply.code(404).send({ error: 'Season not found' });
      }
      if (!canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(403).send({ error: 'Access denied to this season' });
      }
      const zones = await getZonesForSeason(seasonId);
      return { zones };
    }

    const zones = await zoneRepository.findByOrganizationId(organizationId);
    return { zones };
  });

  /**
   * Get season overrides for a zone (tap count and included per season)
   */
  fastify.get('/:id/season-overrides', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    if (zone.organizationId) {
      if (!hasOperationRole(request.memberships, zone.organizationId, 'read')) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    } else if (zone.seasonId) {
      const season = await seasonRepository.findById(zone.seasonId);
      if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    } else if (zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    const overrides = await seasonZoneRepository.findByZoneId(request.params.id);
    return {
      overrides: overrides.map((o) => ({
        seasonId: o.seasonId,
        tapCount: o.tapCount,
        included: o.included,
      })),
    };
  });

  /**
   * Get a specific zone (access via org or legacy season)
   */
  fastify.get('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    if (zone.organizationId) {
      if (!hasOperationRole(request.memberships, zone.organizationId, 'read')) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    } else if (zone.seasonId) {
      const season = await seasonRepository.findById(zone.seasonId);
      if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    } else if (zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    return { zone };
  });

  /**
   * Create a new zone (org-scoped)
   */
  fastify.post('/', async (request, reply) => {
    const { organizationId, name, tapCount, description, color, location } = request.body;

    let orgId = organizationId;
    if (!orgId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason?.organizationId) {
        return reply.code(400).send({ error: 'Operation required. Select an operation or provide organizationId.' });
      }
      orgId = activeSeason.organizationId;
    }

    if (!hasOperationRole(request.memberships, orgId, 'write')) {
      return reply.code(403).send({ error: 'Write access required to add zones to this operation' });
    }

    const locationParsed = parseLocation(location);
    if (location !== undefined && location !== null && locationParsed === undefined) {
      return reply.code(400).send({ error: 'Invalid location: lat and lng must be numbers.' });
    }

    const zone = await zoneRepository.create({
      organizationId: orgId,
      userId: request.user.id,
      name,
      tapCount: tapCount || 0,
      description,
      color: color || '#8B7355',
      ...(locationParsed !== undefined && { location: locationParsed }),
    });
    return { zone };
  });

  /**
   * Update a zone
   */
  fastify.patch('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    if (!(await canWriteZone(zone, request.user.id, request.memberships))) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    const body = { ...request.body };
    if ('location' in body) {
      const locationParsed = parseLocation(body.location);
      if (body.location != null && locationParsed === undefined) {
        return reply.code(400).send({ error: 'Invalid location: lat and lng must be numbers.' });
      }
      body.location = locationParsed ?? null;
    }
    const updated = await zoneRepository.update(request.params.id, body);
    return { zone: updated };
  });

  /**
   * Delete a zone
   */
  fastify.delete('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    if (!(await canWriteZone(zone, request.user.id, request.memberships))) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    await zoneRepository.delete(request.params.id);
    return { success: true };
  });
};
