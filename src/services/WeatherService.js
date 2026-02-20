/**
 * Weather Service - Open-Meteo integration
 * Free weather API, no API key required
 */

import { weatherCacheRepository } from '../storage/repositories/WeatherCacheRepository.js';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1';
const OPEN_METEO_ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1';

/**
 * Fetch weather data from Open-Meteo Forecast API (for recent/future data)
 */
async function fetchFromOpenMeteo(lat, lng, options = {}) {
  const {
    pastDays = 7,
    forecastDays = 7,
  } = options;

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_hours',
      'weathercode',
      'sunrise',
      'sunset',
      'windspeed_10m_max',
      'winddirection_10m_dominant',
      'shortwave_radiation_sum',
      'sunshine_duration',
    ].join(','),
    hourly: [
      'relativehumidity_2m',
      'surface_pressure',
    ].join(','),
    past_days: pastDays,
    forecast_days: forecastDays,
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    windspeed_unit: 'mph',
  });

  const response = await fetch(`${OPEN_METEO_BASE}/forecast?${params}`);

  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch historical weather data from Open-Meteo Archive API
 * Used for dates older than ~90 days
 */
async function fetchFromArchive(lat, lng, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    start_date: startDate,
    end_date: endDate,
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_hours',
      'weathercode',
      'sunrise',
      'sunset',
      'windspeed_10m_max',
      'winddirection_10m_dominant',
      'shortwave_radiation_sum',
      'sunshine_duration',
    ].join(','),
    hourly: [
      'relativehumidity_2m',
      'surface_pressure',
    ].join(','),
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    windspeed_unit: 'mph',
  });

  let response = await fetch(`${OPEN_METEO_ARCHIVE_BASE}/archive?${params}`);

  if (!response.ok) {
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 2500));
      response = await fetch(`${OPEN_METEO_ARCHIVE_BASE}/archive?${params}`);
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Archive API error: ${response.status} - ${errorText}`);
      throw new Error(`Archive Weather API error: ${response.status}`);
    }
  }

  return response.json();
}

/**
 * Calculate daily averages from hourly data for a specific day index
 */
function calculateHourlyAverages(hourly, dayIndex) {
  const startHour = dayIndex * 24;
  const endHour = startHour + 24;
  
  let humiditySum = 0;
  let humidityCount = 0;
  let pressureSum = 0;
  let pressureCount = 0;
  
  for (let h = startHour; h < endHour && h < hourly.time.length; h++) {
    if (hourly.relativehumidity_2m && hourly.relativehumidity_2m[h] != null) {
      humiditySum += hourly.relativehumidity_2m[h];
      humidityCount++;
    }
    if (hourly.surface_pressure && hourly.surface_pressure[h] != null) {
      pressureSum += hourly.surface_pressure[h];
      pressureCount++;
    }
  }
  
  return {
    humidityAvg: humidityCount > 0 ? Math.round(humiditySum / humidityCount) : null,
    pressureAvg: pressureCount > 0 ? Math.round((pressureSum / pressureCount) * 10) / 10 : null,
  };
}

/**
 * Parse Open-Meteo response into daily records
 */
function parseWeatherResponse(data) {
  const { daily, hourly, timezone } = data;
  const days = [];

  for (let i = 0; i < daily.time.length; i++) {
    const hourlyAvgs = hourly ? calculateHourlyAverages(hourly, i) : { humidityAvg: null, pressureAvg: null };
    
    days.push({
      date: daily.time[i],
      tempHigh: daily.temperature_2m_max[i],
      tempLow: daily.temperature_2m_min[i],
      tempAvg: (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2,
      precipitation: daily.precipitation_sum[i],
      precipitationHours: daily.precipitation_hours?.[i] ?? null,
      weatherCode: daily.weathercode[i],
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
      windSpeed: daily.windspeed_10m_max?.[i] ?? null,
      windDirection: daily.winddirection_10m_dominant?.[i] ?? null,
      solarRadiation: daily.shortwave_radiation_sum?.[i] ?? null,
      sunshineHours: daily.sunshine_duration?.[i] != null 
        ? Math.round((daily.sunshine_duration[i] / 3600) * 10) / 10 
        : null,
      humidity: hourlyAvgs.humidityAvg,
      pressure: hourlyAvgs.pressureAvg,
      timezone,
    });
  }

  return days;
}

/**
 * Get weather conditions description from WMO code
 */
export function getConditionsFromCode(code) {
  const conditions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };

  return conditions[code] || 'Unknown';
}

/**
 * Determine if conditions are ideal for sap flow
 * Ideal: freezing nights (F: < 32, C: < 0), warm days (F: > 40, C: > 4.4)
 */
export function isSapFlowIdeal(tempHigh, tempLow, temperatureUnit = 'fahrenheit') {
  if (temperatureUnit === 'celsius') {
    return tempLow < 0 && tempHigh > 4.4;
  }
  return tempLow < 32 && tempHigh > 40;
}

/** Convert temps in a day object from F to C */
function dayToCelsius(day) {
  const fToC = (f) => Math.round((f - 32) * (5 / 9) * 10) / 10;
  return {
    ...day,
    tempHigh: fToC(day.tempHigh),
    tempLow: fToC(day.tempLow),
    tempAvg: fToC(day.tempAvg),
  };
}

/**
 * Weather Service class
 */
class WeatherServiceClass {
  /**
   * Get weather for a specific location and date
   */
  async getWeather(lat, lng, date, temperatureUnit = 'fahrenheit') {
    const cached = await weatherCacheRepository.getCached(lat, lng, date);
    if (cached) {
      return temperatureUnit === 'celsius' ? dayToCelsius(cached) : cached;
    }

    const data = await fetchFromOpenMeteo(lat, lng, {
      pastDays: 14,
      forecastDays: 7,
    });

    const days = parseWeatherResponse(data);

    for (const day of days) {
      await weatherCacheRepository.cache(lat, lng, day.date, day);
    }

    const requestedDay = days.find((d) => d.date === date);
    if (!requestedDay) return null;
    return temperatureUnit === 'celsius' ? dayToCelsius(requestedDay) : requestedDay;
  }

  /**
   * Get weather for a date range
   * Uses archive API for historical dates (older than 30 days)
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   */
  async getWeatherRange(lat, lng, startDate, endDate, temperatureUnit = 'fahrenheit') {
    const cached = await weatherCacheRepository.getCachedRange(lat, lng, startDate, endDate);

    const cachedDates = new Set(cached.map((c) => c.date));
    const missingDates = [];

    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      if (!cachedDates.has(dateStr)) {
        missingDates.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }

    let result;
    if (missingDates.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      const allDays = [...cached];

      const historicalMissing = missingDates.filter(d => d < thirtyDaysAgoStr);
      const recentMissing = missingDates.filter(d => d >= thirtyDaysAgoStr);

      if (historicalMissing.length > 0) {
        const archiveStart = historicalMissing.reduce((a, b) => a < b ? a : b);
        const archiveEnd = historicalMissing.reduce((a, b) => a > b ? a : b);
        
        try {
          const archiveData = await fetchFromArchive(lat, lng, archiveStart, archiveEnd);
          const archiveDays = parseWeatherResponse(archiveData);

          for (const day of archiveDays) {
            await weatherCacheRepository.cache(lat, lng, day.date, day);
            if (!cachedDates.has(day.date)) {
              allDays.push(day);
              cachedDates.add(day.date);
            }
          }
        } catch (err) {
          console.error('Failed to fetch archive weather data:', err.message);
        }
      }

      if (recentMissing.length > 0) {
        try {
          const data = await fetchFromOpenMeteo(lat, lng, {
            pastDays: 30,
            forecastDays: 7,
          });

          const days = parseWeatherResponse(data);

          for (const day of days) {
            await weatherCacheRepository.cache(lat, lng, day.date, day);
            if (!cachedDates.has(day.date)) {
              allDays.push(day);
              cachedDates.add(day.date);
            }
          }
        } catch (err) {
          console.error('Failed to fetch forecast weather data:', err.message);
        }
      }

      result = allDays
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
    } else {
      result = cached.sort((a, b) => a.date.localeCompare(b.date));
    }

    if (temperatureUnit === 'celsius') {
      return result.map(dayToCelsius);
    }
    return result;
  }

  /**
   * Get current/forecast weather
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   */
  async getForecast(lat, lng, temperatureUnit = 'fahrenheit') {
    const data = await fetchFromOpenMeteo(lat, lng, {
      pastDays: 0,
      forecastDays: 7,
    });

    let days = parseWeatherResponse(data);
    if (temperatureUnit === 'celsius') {
      days = days.map(dayToCelsius);
    }

    return days.map((day) => ({
      ...day,
      conditions: getConditionsFromCode(day.weatherCode),
      idealForSap: isSapFlowIdeal(day.tempHigh, day.tempLow, temperatureUnit),
    }));
  }
}

export const weatherService = new WeatherServiceClass();
