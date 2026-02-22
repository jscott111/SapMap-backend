/**
 * Weather Routes
 */

import { weatherService, getConditionsFromCode, isSapFlowIdeal } from '../services/WeatherService.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, hasOperationRole } from '../lib/operationAccess.js';

async function resolveLocation(request, reply) {
  const { lat, lng, zoneId } = request.query || {};

  if (zoneId) {
    const zone = await zoneRepository.findById(zoneId);
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    const orgId = zone.organizationId;
    if (orgId && !hasOperationRole(request.memberships, orgId, 'read')) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    if (!zone.seasonId && !orgId && zone.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Zone not found' });
    }
    if (!zone.location?.lat || zone.location?.lng == null) {
      return reply.code(400).send({
        error: 'This sugar bush has no location set. Set a location in Settings.',
      });
    }
    return { latitude: zone.location.lat, longitude: zone.location.lng };
  }

  let latitude = parseFloat(lat);
  let longitude = parseFloat(lng);

  if (latitude && longitude && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  const activeSeason = await seasonRepository.findActiveSeason(
    request.user.id,
    request.memberships
  );
  if (activeSeason?.location?.lat != null && activeSeason?.location?.lng != null) {
    return {
      latitude: activeSeason.location.lat,
      longitude: activeSeason.location.lng,
    };
  }

  return reply.code(400).send({
    error: 'No location specified. Provide zoneId or lat/lng, or set a location on a sugar bush in Settings.',
  });
}

export const weatherRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request) => {
    request.memberships = await getMembershipsForUser(request.user.id);
  });

  /**
   * Get weather forecast (location from zoneId, lat/lng, or active season)
   */
  fastify.get('/forecast', async (request, reply) => {
    const resolved = await resolveLocation(request, reply);
    if (resolved.latitude == null || resolved.longitude == null) return resolved;
    const { latitude, longitude } = resolved;

    const temperatureUnit = request.user.preferences?.temperatureUnit || 'fahrenheit';
    const forecast = await weatherService.getForecast(latitude, longitude, temperatureUnit);
    return { forecast };
  });

  /**
   * Get weather for a specific date
   */
  fastify.get('/date/:date', async (request, reply) => {
    const { date } = request.params;
    const resolved = await resolveLocation(request, reply);
    if (resolved.latitude == null || resolved.longitude == null) return resolved;
    const { latitude, longitude } = resolved;

    const temperatureUnit = request.user.preferences?.temperatureUnit || 'fahrenheit';
    const weather = await weatherService.getWeather(latitude, longitude, date, temperatureUnit);

    if (!weather) {
      return reply.code(404).send({ error: 'Weather data not available for this date' });
    }

    return {
      weather: {
        ...weather,
        conditions: getConditionsFromCode(weather.weatherCode),
        idealForSap: isSapFlowIdeal(weather.tempHigh, weather.tempLow, temperatureUnit),
      },
    };
  });

  /**
   * Get weather for a date range
   */
  fastify.get('/range', async (request, reply) => {
    const { startDate, endDate } = request.query;

    if (!startDate || !endDate) {
      return reply.code(400).send({ error: 'startDate and endDate are required' });
    }

    const resolved = await resolveLocation(request, reply);
    if (resolved.latitude == null || resolved.longitude == null) return resolved;
    const { latitude, longitude } = resolved;

    const temperatureUnit = request.user.preferences?.temperatureUnit || 'fahrenheit';
    const weatherData = await weatherService.getWeatherRange(
      latitude,
      longitude,
      startDate,
      endDate,
      temperatureUnit
    );

    const weather = weatherData.map((day) => ({
      ...day,
      conditions: getConditionsFromCode(day.weatherCode),
      idealForSap: isSapFlowIdeal(day.tempHigh, day.tempLow, temperatureUnit),
    }));

    return { weather };
  });
};
