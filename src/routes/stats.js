/**
 * Stats Routes
 */

import { statsService } from '../services/StatsService.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';

export const statsRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * Get season overview stats
   */
  fastify.get('/season', async (request, reply) => {
    const { seasonId, unit } = request.query;

    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return reply.code(404).send({ error: 'No active season' });
      }
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    const preferredUnit = unit || request.user.preferences?.units || 'gallons';
    const stats = await statsService.getSeasonStats(targetSeasonId, preferredUnit);

    return { stats };
  });

  /**
   * Get zone-level stats
   */
  fastify.get('/zones', async (request, reply) => {
    const { seasonId, unit } = request.query;

    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason) {
        return reply.code(404).send({ error: 'No active season' });
      }
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    const preferredUnit = unit || request.user.preferences?.units || 'gallons';
    const zoneStats = await statsService.getZoneStats(targetSeasonId, preferredUnit);

    return { zoneStats };
  });

  /**
   * Get weather correlation data
   */
  fastify.get('/weather-correlation', async (request, reply) => {
    const { seasonId, lat, lng } = request.query;

    let targetSeasonId = seasonId;
    let season;

    if (!targetSeasonId) {
      season = await seasonRepository.findActiveSeason(request.user.id);
      if (!season) {
        return reply.code(404).send({ error: 'No active season' });
      }
      targetSeasonId = season.id;
    } else {
      season = await seasonRepository.findById(seasonId);
      if (!season || season.userId !== request.user.id) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    // Get coordinates
    let latitude = parseFloat(lat);
    let longitude = parseFloat(lng);

    if (!latitude || !longitude) {
      if (!season.location?.lat) {
        return reply.code(400).send({
          error: 'No location specified. Provide lat/lng or set a location on your season.',
        });
      }
      latitude = season.location.lat;
      longitude = season.location.lng;
    }

    const temperatureUnit = request.user.preferences?.temperatureUnit || 'fahrenheit';
    const correlation = await statsService.getWeatherCorrelation(
      targetSeasonId,
      latitude,
      longitude,
      temperatureUnit
    );

    return { correlation };
  });
};
