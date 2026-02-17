/**
 * Collection Routes
 */

import { collectionRepository } from '../storage/repositories/CollectionRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { authenticate } from '../middleware/auth.js';

export const collectionRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * Get all collections for a season
   */
  fastify.get('/', async (request, reply) => {
    const { seasonId, zoneId, startDate, endDate } = request.query;

    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return { collections: [] };
      }
      targetSeasonId = activeSeason.id;
    } else {
      // Verify user owns this season
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    let collections;

    if (zoneId) {
      collections = await collectionRepository.findByZoneId(zoneId);
    } else if (startDate && endDate) {
      collections = await collectionRepository.findByDateRange(
        targetSeasonId,
        startDate,
        endDate
      );
    } else {
      collections = await collectionRepository.findBySeasonId(targetSeasonId);
    }

    return { collections };
  });

  /**
   * Get daily totals for a season
   */
  fastify.get('/daily', async (request, reply) => {
    const seasonId = request.query.seasonId;

    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return { dailyTotals: [] };
      }
      targetSeasonId = activeSeason.id;
    }

    const dailyTotals = await collectionRepository.getDailyTotals(targetSeasonId);
    return { dailyTotals };
  });

  /**
   * Get a specific collection
   */
  fastify.get('/:id', async (request, reply) => {
    const collection = await collectionRepository.findById(request.params.id);

    if (!collection || collection.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    return { collection };
  });

  /**
   * Create a new collection entry
   */
  fastify.post('/', async (request, reply) => {
    const {
      seasonId,
      zoneId,
      date,
      volume,
      volumeUnit,
      sugarContent,
      notes,
      temperature,
      weatherData,
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

    // Verify zone if provided
    if (zoneId) {
      const zone = await zoneRepository.findById(zoneId);
      if (!zone || zone.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    }

    const collection = await collectionRepository.create({
      seasonId: targetSeasonId,
      userId: request.user.id,
      zoneId,
      date: date || new Date().toISOString().split('T')[0],
      volume: volume || 0,
      volumeUnit: volumeUnit || 'gallons',
      sugarContent,
      notes,
      temperature,
      weatherData,
    });

    return { collection };
  });

  /**
   * Update a collection
   */
  fastify.patch('/:id', async (request, reply) => {
    const collection = await collectionRepository.findById(request.params.id);

    if (!collection || collection.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    const updated = await collectionRepository.update(request.params.id, request.body);
    return { collection: updated };
  });

  /**
   * Delete a collection
   */
  fastify.delete('/:id', async (request, reply) => {
    const collection = await collectionRepository.findById(request.params.id);

    if (!collection || collection.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    await collectionRepository.delete(request.params.id);
    return { success: true };
  });
};
