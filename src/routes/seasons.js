/**
 * Season Routes
 */

import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { seasonZoneRepository } from '../storage/repositories/SeasonZoneRepository.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, canAccessSeason, canWriteSeason, hasOperationRole } from '../lib/operationAccess.js';

export const seasonRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request) => {
    request.memberships = await getMembershipsForUser(request.user.id);
  });

  /**
   * Get all seasons accessible to the current user (orgs only; no personal seasons)
   */
  fastify.get('/', async (request) => {
    const all = await seasonRepository.findAccessibleByUser(
      request.user.id,
      request.memberships
    );
    const seasons = all.filter((s) => s.organizationId);
    return { seasons };
  });

  /**
   * Get the active season (among accessible org seasons only)
   */
  fastify.get('/active', async (request) => {
    const season = await seasonRepository.findActiveSeason(
      request.user.id,
      request.memberships
    );
    if (!season || !season.organizationId) {
      return { season: null };
    }
    return { season };
  });

  /**
   * Get a specific season
   */
  fastify.get('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);
    if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    return { season };
  });

  /**
   * Create a new season (organizationId required; requires write in that org)
   */
  fastify.post('/', async (request, reply) => {
    const { name, year, startDate, endDate, location, organizationId } = request.body;

    if (!organizationId) {
      return reply.code(400).send({ error: 'Operation is required. Create or select an operation first.' });
    }

    const hasWrite = (request.memberships || []).some(
      (m) => m.organizationId === organizationId && (m.role === 'write' || m.role === 'admin')
    );
    if (!hasWrite) {
      return reply.code(403).send({ error: 'Write access required to create seasons in this operation' });
    }

    const season = await seasonRepository.create({
      userId: request.user.id,
      organizationId,
      name: name || `${year || new Date().getFullYear()} Season`,
      year: year || new Date().getFullYear(),
      startDate,
      endDate,
      location,
      isActive: true,
    });

    await seasonRepository.setActive(season.id, request.user.id, request.memberships);
    return { season };
  });

  /**
   * Update a season
   */
  fastify.patch('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    const updated = await seasonRepository.update(request.params.id, request.body);
    return { season: updated };
  });

  /**
   * Update a zone's settings for a season (tap count override, include/exclude from season).
   * Body: { tapCount?: number, included?: boolean }
   */
  fastify.patch('/:seasonId/zones/:zoneId', async (request, reply) => {
    const { seasonId, zoneId } = request.params;
    const season = await seasonRepository.findById(seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    const orgId = season.organizationId;
    if (!orgId || !hasOperationRole(request.memberships, orgId, 'write')) {
      return reply.code(403).send({ error: 'Write access required' });
    }
    const zone = await zoneRepository.findById(zoneId);
    if (!zone || zone.organizationId !== orgId) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    const { tapCount, included } = request.body || {};
    const data = {};
    if (tapCount !== undefined) data.tapCount = Number(tapCount);
    if (included !== undefined) data.included = Boolean(included);
    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Provide tapCount and/or included' });
    }
    const seasonZone = await seasonZoneRepository.set(seasonId, zoneId, data);
    return { seasonZone };
  });

  /**
   * Remove a zone's override for a season (revert to included with zone default tap count).
   */
  fastify.delete('/:seasonId/zones/:zoneId', async (request, reply) => {
    const { seasonId, zoneId } = request.params;
    const season = await seasonRepository.findById(seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    const orgId = season.organizationId;
    if (!orgId || !hasOperationRole(request.memberships, orgId, 'write')) {
      return reply.code(403).send({ error: 'Write access required' });
    }
    const zone = await zoneRepository.findById(zoneId);
    if (!zone || zone.organizationId !== orgId) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    await seasonZoneRepository.delete(seasonId, zoneId);
    return { success: true };
  });

  /**
   * Set a season as active (requires write; read-only users cannot change active season)
   */
  fastify.post('/:id/activate', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    try {
      const updated = await seasonRepository.setActive(
        request.params.id,
        request.user.id,
        request.memberships
      );
      return { season: updated };
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  /**
   * Delete a season
   */
  fastify.delete('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Season not found' });
    }
    await seasonRepository.delete(request.params.id);
    return { success: true };
  });
};
