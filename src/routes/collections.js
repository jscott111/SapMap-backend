/**
 * Collection Routes
 */

import { collectionRepository } from '../storage/repositories/CollectionRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, canAccessSeason, canWriteSeason } from '../lib/operationAccess.js';

/** Enrich collections with creator display info (id, name) */
async function enrichWithCreatedBy(collections) {
  const userIds = [...new Set(collections.map((c) => c.userId).filter(Boolean))];
  if (userIds.length === 0) return collections.map((c) => ({ ...c, createdBy: null }));
  const users = await Promise.all(userIds.map((id) => userRepository.findById(id)));
  const userMap = Object.fromEntries(userIds.map((id, i) => [id, users[i]]));
  return collections.map((c) => ({
    ...c,
    createdBy: c.userId
      ? { id: c.userId, name: userMap[c.userId]?.name ?? 'Unknown' }
      : null,
  }));
}

/** Zone belongs to the same org as the season, or (legacy) zone is scoped to this season */
function zoneBelongsToSeason(zone, season) {
  if (zone.organizationId && season.organizationId) {
    return zone.organizationId === season.organizationId;
  }
  return zone.seasonId === season.id;
}

export const collectionRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request) => {
    request.memberships = await getMembershipsForUser(request.user.id);
  });

  /**
   * Get all collections for a season
   */
  fastify.get('/', async (request, reply) => {
    const { seasonId, zoneId, startDate, endDate } = request.query;
    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) return { collections: [] };
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    let collections;
    if (zoneId) {
      const [zone, season] = await Promise.all([
        zoneRepository.findById(zoneId),
        seasonRepository.findById(targetSeasonId),
      ]);
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });
      if (!season || !zoneBelongsToSeason(zone, season)) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
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
    const enriched = await enrichWithCreatedBy(collections);
    return { collections: enriched };
  });

  /**
   * Get daily totals for a season
   */
  fastify.get('/daily', async (request, reply) => {
    const seasonId = request.query.seasonId;
    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) return { dailyTotals: [] };
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }
    const dailyTotals = await collectionRepository.getDailyTotals(targetSeasonId);
    return { dailyTotals };
  });

  /**
   * Get a specific collection (access via season)
   */
  fastify.get('/:id', async (request, reply) => {
    const collection = await collectionRepository.findById(request.params.id);
    if (!collection) return reply.code(404).send({ error: 'Collection not found' });
    const season = await seasonRepository.findById(collection.seasonId);
    if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Collection not found' });
    }
    const [enriched] = await enrichWithCreatedBy([collection]);
    return { collection: enriched };
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

    let targetSeasonId = seasonId;
    let season;
    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) {
        return reply.code(400).send({ error: 'No active season. Create a season first.' });
      }
      targetSeasonId = activeSeason.id;
      season = activeSeason;
    } else {
      season = await seasonRepository.findById(seasonId);
      if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    if (zoneId) {
      const zone = await zoneRepository.findById(zoneId);
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });
      if (!zoneBelongsToSeason(zone, season)) {
        return reply.code(404).send({ error: 'Zone not found' });
      }
    }

    const collection = await collectionRepository.create({
      seasonId: targetSeasonId,
      userId: request.user.id,
      zoneId,
      date: date || new Date().toISOString().split('T')[0],
      volume: volume ?? 0,
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
    if (!collection) return reply.code(404).send({ error: 'Collection not found' });
    const season = await seasonRepository.findById(collection.seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Collection not found' });
    }
    const { volumeUnit: _dropped, zoneId: patchZoneId, ...body } = request.body;
    if (patchZoneId !== undefined) {
      if (patchZoneId) {
        const zone = await zoneRepository.findById(patchZoneId);
        if (!zone || !zoneBelongsToSeason(zone, season)) {
          return reply.code(400).send({ error: 'Zone not found or does not belong to this season\'s operation' });
        }
        body.zoneId = patchZoneId;
      } else {
        body.zoneId = null;
      }
    }
    const updated = await collectionRepository.update(request.params.id, body);
    return { collection: updated };
  });

  /**
   * Delete a collection
   */
  fastify.delete('/:id', async (request, reply) => {
    const collection = await collectionRepository.findById(request.params.id);
    if (!collection) return reply.code(404).send({ error: 'Collection not found' });
    const season = await seasonRepository.findById(collection.seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Collection not found' });
    }
    await collectionRepository.delete(request.params.id);
    return { success: true };
  });
};
