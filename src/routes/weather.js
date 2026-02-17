/**
 * Weather Routes
 */

import { weatherService, getConditionsFromCode, isSapFlowIdeal } from '../services/WeatherService.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';

export const weatherRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);

  /**
   * Get weather forecast for the active season's location
   */
  fastify.get('/forecast', async (request, reply) => {
    const { lat, lng } = request.query;

    let latitude = parseFloat(lat);
    let longitude = parseFloat(lng);

    // If no coordinates provided, use active season's location
    if (!latitude || !longitude) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason?.location?.lat) {
        return reply.code(400).send({
          error: 'No location specified. Provide lat/lng or set a location on your active season.',
        });
      }
      latitude = activeSeason.location.lat;
      longitude = activeSeason.location.lng;
    }

    const temperatureUnit = request.user.preferences?.temperatureUnit || 'fahrenheit';
    const forecast = await weatherService.getForecast(latitude, longitude, temperatureUnit);
    return { forecast };
  });

  /**
   * Get weather for a specific date
   */
  fastify.get('/date/:date', async (request, reply) => {
    const { date } = request.params;
    const { lat, lng } = request.query;

    let latitude = parseFloat(lat);
    let longitude = parseFloat(lng);

    if (!latitude || !longitude) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason?.location?.lat) {
        return reply.code(400).send({
          error: 'No location specified.',
        });
      }
      latitude = activeSeason.location.lat;
      longitude = activeSeason.location.lng;
    }

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
    const { startDate, endDate, lat, lng } = request.query;

    if (!startDate || !endDate) {
      return reply.code(400).send({ error: 'startDate and endDate are required' });
    }

    let latitude = parseFloat(lat);
    let longitude = parseFloat(lng);

    if (!latitude || !longitude) {
      const activeSeason = await seasonRepository.findActiveSeason(request.user.id);
      if (!activeSeason?.location?.lat) {
        return reply.code(400).send({
          error: 'No location specified.',
        });
      }
      latitude = activeSeason.location.lat;
      longitude = activeSeason.location.lng;
    }

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
