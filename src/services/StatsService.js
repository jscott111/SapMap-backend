/**
 * Stats Service - Yield calculations and aggregations
 */

import { collectionRepository } from '../storage/repositories/CollectionRepository.js';
import { boilRepository } from '../storage/repositories/BoilRepository.js';
import { zoneRepository } from '../storage/repositories/ZoneRepository.js';
import { weatherService, isSapFlowIdeal } from './WeatherService.js';

/**
 * Calculate the "Rule of 86" - estimate syrup yield from Brix reading
 * Formula: gallons of sap needed = 86 / Brix
 */
export function calculateRuleOf86(brix) {
  if (!brix || brix <= 0) return null;
  return 86 / brix;
}

/**
 * Convert volume between units
 */
export function convertVolume(volume, fromUnit, toUnit) {
  if (fromUnit === toUnit) return volume;

  const gallonsToLiters = 3.78541;

  if (fromUnit === 'gallons' && toUnit === 'liters') {
    return volume * gallonsToLiters;
  }
  if (fromUnit === 'liters' && toUnit === 'gallons') {
    return volume / gallonsToLiters;
  }

  return volume;
}

class StatsServiceClass {
  /**
   * Get comprehensive stats for a season (all volumes in liters)
   */
  async getSeasonStats(seasonId) {
    const [collections, boils, zones] = await Promise.all([
      collectionRepository.findBySeasonId(seasonId),
      boilRepository.findBySeasonId(seasonId),
      zoneRepository.findBySeasonId(seasonId),
    ]);

    // Total sap collected (stored in liters)
    const totalSapCollected = collections.reduce((t, col) => t + (col.volume || 0), 0);

    // Total sap processed (boiled, stored in liters)
    const totalSapProcessed = boils.reduce((t, b) => t + (b.sapVolumeIn || 0), 0);

    // Total syrup produced
    const totalSyrupProduced = boils.reduce((t, b) => t + (b.syrupVolumeOut || 0), 0);

    // Yield ratio (sap to syrup)
    const yieldRatio = totalSyrupProduced > 0
      ? totalSapProcessed / totalSyrupProduced
      : null;

    // Average sugar content (Brix)
    const collectionsWithBrix = collections.filter((c) => c.sugarContent > 0);
    const avgBrix = collectionsWithBrix.length > 0
      ? collectionsWithBrix.reduce((t, c) => t + c.sugarContent, 0) / collectionsWithBrix.length
      : null;

    // Total taps
    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    // Sap per tap (if we have tap data)
    const sapPerTap = totalTaps > 0 ? totalSapCollected / totalTaps : null;

    // Collection days
    const collectionDays = new Set(collections.map((c) => c.date.split('T')[0])).size;

    // Boil sessions
    const boilSessions = boils.length;

    // Total boil time (minutes)
    const totalBoilTime = boils.reduce((t, b) => t + (b.duration || 0), 0);

    // Average collection per day
    const avgCollectionPerDay = collectionDays > 0
      ? totalSapCollected / collectionDays
      : 0;

    // Estimated remaining syrup (based on sap collected but not yet processed)
    const sapPending = totalSapCollected - totalSapProcessed;
    const estimatedPendingSyrup = yieldRatio && sapPending > 0
      ? sapPending / yieldRatio
      : 0;

    return {
      totalSapCollected: Math.round(totalSapCollected * 100) / 100,
      totalSapProcessed: Math.round(totalSapProcessed * 100) / 100,
      totalSyrupProduced: Math.round(totalSyrupProduced * 1000) / 1000,
      sapPending: Math.round(sapPending * 100) / 100,
      estimatedPendingSyrup: Math.round(estimatedPendingSyrup * 1000) / 1000,
      yieldRatio: yieldRatio ? Math.round(yieldRatio * 10) / 10 : null,
      avgBrix: avgBrix ? Math.round(avgBrix * 10) / 10 : null,
      totalTaps,
      sapPerTap: sapPerTap ? Math.round(sapPerTap * 100) / 100 : null,
      collectionDays,
      boilSessions,
      totalBoilTimeMinutes: Math.round(totalBoilTime),
      avgCollectionPerDay: Math.round(avgCollectionPerDay * 100) / 100,
      zoneCount: zones.length,
      collectionCount: collections.length,
    };
  }

  /**
   * Get zone-level stats (volumes in liters)
   */
  async getZoneStats(seasonId) {
    const [collections, zones] = await Promise.all([
      collectionRepository.findBySeasonId(seasonId),
      zoneRepository.findBySeasonId(seasonId),
    ]);

    const zoneStats = [];

    for (const zone of zones) {
      const zoneCollections = collections.filter((c) => c.zoneId === zone.id);
      const totalVolume = zoneCollections.reduce((t, col) => t + (col.volume || 0), 0);

      const sapPerTap = zone.tapCount > 0 ? totalVolume / zone.tapCount : null;

      zoneStats.push({
        zoneId: zone.id,
        zoneName: zone.name,
        color: zone.color,
        tapCount: zone.tapCount || 0,
        totalVolume: Math.round(totalVolume * 100) / 100,
        collectionCount: zoneCollections.length,
        sapPerTap: sapPerTap ? Math.round(sapPerTap * 100) / 100 : null,
      });
    }

    return zoneStats.sort((a, b) => b.totalVolume - a.totalVolume);
  }

  /**
   * Get weather correlation data
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   */
  async getWeatherCorrelation(seasonId, lat, lng, temperatureUnit = 'fahrenheit') {
    const collections = await collectionRepository.findBySeasonId(seasonId);

    if (collections.length === 0) {
      return { data: [], correlation: null };
    }

    const dates = collections.map((c) => c.date.split('T')[0]);
    const startDate = dates.reduce((a, b) => (a < b ? a : b));
    const endDate = dates.reduce((a, b) => (a > b ? a : b));

    const weather = await weatherService.getWeatherRange(lat, lng, startDate, endDate, temperatureUnit);
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));

    const collectionsByDate = new Map();
    for (const col of collections) {
      const date = col.date.split('T')[0];
      const existing = collectionsByDate.get(date) || 0;
      collectionsByDate.set(date, existing + (col.volume || 0));
    }

    const data = [];
    for (const [date, volume] of collectionsByDate) {
      const w = weatherByDate.get(date);
      if (w) {
        data.push({
          date,
          volume,
          tempHigh: w.tempHigh,
          tempLow: w.tempLow,
          tempDelta: w.tempHigh - w.tempLow,
          precipitation: w.precipitation,
          idealConditions: isSapFlowIdeal(w.tempHigh, w.tempLow, temperatureUnit),
        });
      }
    }

    // Calculate simple correlation coefficient (temperature delta vs volume)
    let correlation = null;
    if (data.length >= 3) {
      const tempDeltas = data.map((d) => d.tempDelta);
      const volumes = data.map((d) => d.volume);

      const avgDelta = tempDeltas.reduce((a, b) => a + b, 0) / tempDeltas.length;
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

      let numerator = 0;
      let denomDelta = 0;
      let denomVolume = 0;

      for (let i = 0; i < data.length; i++) {
        const deltaDeviation = tempDeltas[i] - avgDelta;
        const volumeDeviation = volumes[i] - avgVolume;
        numerator += deltaDeviation * volumeDeviation;
        denomDelta += deltaDeviation ** 2;
        denomVolume += volumeDeviation ** 2;
      }

      const denominator = Math.sqrt(denomDelta * denomVolume);
      if (denominator > 0) {
        correlation = Math.round((numerator / denominator) * 100) / 100;
      }
    }

    return {
      data: data.sort((a, b) => a.date.localeCompare(b.date)),
      correlation,
      idealDaysCount: data.filter((d) => d.idealConditions).length,
      totalDays: data.length,
    };
  }
}

export const statsService = new StatsServiceClass();
