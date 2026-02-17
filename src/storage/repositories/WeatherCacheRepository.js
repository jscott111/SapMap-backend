/**
 * Weather Cache Repository for caching weather data
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections, getDb } from '../firestore.js';

class WeatherCacheRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.WEATHER_CACHE);
  }

  /**
   * Generate a cache key for a location and date
   */
  getCacheKey(lat, lng, date) {
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLng = Math.round(lng * 100) / 100;
    return `${roundedLat}_${roundedLng}_${date}`;
  }

  /**
   * Get cached weather for a location and date
   */
  async getCached(lat, lng, date) {
    const cacheKey = this.getCacheKey(lat, lng, date);
    const cached = await this.findById(cacheKey);

    if (!cached) return null;

    // Check if cache is still valid (24 hours for historical, 1 hour for today/future)
    const fetchedAt = new Date(cached.fetchedAt);
    const now = new Date();
    const cacheAge = (now - fetchedAt) / 1000 / 60; // minutes

    const dateObj = new Date(date);
    const isHistorical = dateObj < new Date(new Date().toDateString());
    const maxAge = isHistorical ? 24 * 60 : 60; // 24 hours for historical, 1 hour for current/future

    if (cacheAge > maxAge) {
      return null;
    }

    return cached;
  }

  /**
   * Cache weather data
   */
  async cache(lat, lng, date, weatherData) {
    const cacheKey = this.getCacheKey(lat, lng, date);

    const data = {
      lat,
      lng,
      date,
      ...weatherData,
      fetchedAt: new Date().toISOString(),
    };

    return this.createWithId(cacheKey, data);
  }

  /**
   * Get weather for a date range
   */
  async getCachedRange(lat, lng, startDate, endDate) {
    const results = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const cached = await this.getCached(lat, lng, dateStr);
      if (cached) {
        results.push(cached);
      }
      current.setDate(current.getDate() + 1);
    }

    return results;
  }
}

export const weatherCacheRepository = new WeatherCacheRepositoryClass();
