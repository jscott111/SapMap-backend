/**
 * Boil Routes
 */

import { boilRepository } from '../storage/repositories/BoilRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';

export const boilRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * Get all boils for a season
   */
  fastify.get('/', async (request, reply) => {
    const seasonId = request.query.seasonId;

    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return { boils: [] };
      }
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    const boils = await boilRepository.findBySeasonId(targetSeasonId);
    return { boils };
  });

  /**
   * Get a specific boil
   */
  fastify.get('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);

    if (!boil || boil.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Boil not found' });
    }

    return { boil };
  });

  /**
   * Create a new boil entry
   */
  fastify.post('/', async (request, reply) => {
    const {
      seasonId,
      date,
      sapVolumeIn,
      syrupVolumeOut,
      startTime,
      endTime,
      duration,
      notes,
    } = request.body;

    // Get season (use provided or active)
    let targetSeasonId = seasonId;
    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return reply.code(400).send({ error: 'No active season. Create a season first.' });
      }
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    // Calculate duration if start/end times provided
    let calculatedDuration = duration;
    if (startTime && endTime && !duration) {
      const start = new Date(`1970-01-01T${startTime}`);
      const end = new Date(`1970-01-01T${endTime}`);
      calculatedDuration = (end - start) / 1000 / 60; // minutes
    }

    const boil = await boilRepository.create({
      seasonId: targetSeasonId,
      userId: request.user.id,
      date: date || new Date().toISOString().split('T')[0],
      sapVolumeIn: sapVolumeIn || 0,
      syrupVolumeOut: syrupVolumeOut || 0,
      startTime,
      endTime,
      duration: calculatedDuration,
      notes,
    });

    return { boil };
  });

  /**
   * Update a boil
   */
  fastify.patch('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);

    if (!boil || boil.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Boil not found' });
    }

    const updated = await boilRepository.update(request.params.id, request.body);
    return { boil: updated };
  });

  /**
   * Delete a boil
   */
  fastify.delete('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);

    if (!boil || boil.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Boil not found' });
    }

    await boilRepository.delete(request.params.id);
    return { success: true };
  });
};
