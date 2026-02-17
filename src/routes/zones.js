/**
 * Zone Routes
 */

import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';

export const zoneRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * Get all zones for the active season
   */
  fastify.get('/', async (request, reply) => {
    const seasonId = request.query.seasonId;

    if (seasonId) {
      // Verify user owns this season
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
      const zones = await zoneRepository.findBySeasonId(seasonId);
      return { zones };
    }

    // Get zones for active season
    const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
    if (!activeSeason) {
      return { zones: [] };
    }

    const zones = await zoneRepository.findBySeasonId(activeSeason.id);
    return { zones };
  });

  /**
   * Get a specific zone
   */
  fastify.get('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);

    if (!zone || zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }

    return { zone };
  });

  /**
   * Create a new zone
   */
  fastify.post('/', async (request, reply) => {
    const { seasonId, name, tapCount, description, color } = request.body;

    // Verify user owns this season
    const season = await seasonRepository.findById(seasonId);
    if (!season || season.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    const zone = await zoneRepository.create({
      seasonId,
      userId: request.user.id,
      name,
      tapCount: tapCount || 0,
      description,
      color: color || '#8B7355',
    });

    return { zone };
  });

  /**
   * Update a zone
   */
  fastify.patch('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);

    if (!zone || zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }

    const updated = await zoneRepository.update(request.params.id, request.body);
    return { zone: updated };
  });

  /**
   * Delete a zone
   */
  fastify.delete('/:id', async (request, reply) => {
    const zone = await zoneRepository.findById(request.params.id);

    if (!zone || zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }

    await zoneRepository.delete(request.params.id);
    return { success: true };
  });
};
