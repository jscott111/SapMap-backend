/**
 * Season Routes
 */

import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, canAccessSeason, canWriteSeason } from '../lib/orgAccess.js';

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
      return reply.code(400).send({ error: 'Organization is required. Create or select an organization first.' });
    }

    const hasWrite = (request.memberships || []).some(
      (m) => m.organizationId === organizationId && (m.role === 'write' || m.role === 'admin')
    );
    if (!hasWrite) {
      return reply.code(403).send({ error: 'Write access required to create seasons in this organization' });
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
