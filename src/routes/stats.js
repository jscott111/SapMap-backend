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
    const { seasonId } = request.query;

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

    const stats = await statsService.getSeasonStats(targetSeasonId);
    return { stats };
  });

  /**
   * Get zone-level stats
   */
  fastify.get('/zones', async (request, reply) => {
    const { seasonId } = request.query;

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

    const zoneStats = await statsService.getZoneStats(targetSeasonId);
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

  /**
   * Get weather analytics: detailed correlation + flow predictions in one request (one backend fetch for correlation)
   */
  fastify.get('/weather-analytics', async (request, reply) => {
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
    const detailedCorrelation = await statsService.getDetailedWeatherCorrelation(
      targetSeasonId,
      latitude,
      longitude,
      temperatureUnit
    );

    let flowPredictions;
    try {
      flowPredictions = await statsService.getFlowPredictions(
        targetSeasonId,
        latitude,
        longitude,
        temperatureUnit,
        detailedCorrelation
      );
    } catch (err) {
      fastify.log.warn({ err }, 'Flow predictions failed, returning insufficientData');
      flowPredictions = {
        predictions: [],
        insufficientData: true,
        totalDays: detailedCorrelation.data?.length ?? 0,
      };
    }

    let conventionalPredictions;
    try {
      conventionalPredictions = await statsService.getTraditionalFlowPredictions(
        targetSeasonId,
        latitude,
        longitude,
        temperatureUnit,
        detailedCorrelation
      );
    } catch (err) {
      fastify.log.warn({ err }, 'Conventional predictions failed');
      conventionalPredictions = {
        predictions: [],
        insufficientData: true,
        totalDays: detailedCorrelation.data?.length ?? 0,
      };
    }

    return { detailedCorrelation, flowPredictions, conventionalPredictions };
  });

  /**
   * Get detailed weather correlation analysis with all weather factors
   */
  fastify.get('/detailed-weather-correlation', async (request, reply) => {
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
    const result = await statsService.getDetailedWeatherCorrelation(
      targetSeasonId,
      latitude,
      longitude,
      temperatureUnit
    );

    return result;
  });

  /**
   * Get flow predictions for the next 7 days (learned from temperature history vs volume)
   */
  fastify.get('/flow-predictions', async (request, reply) => {
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
    const result = await statsService.getFlowPredictions(
      targetSeasonId,
      latitude,
      longitude,
      temperatureUnit
    );

    return result;
  });
};
