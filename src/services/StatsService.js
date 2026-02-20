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

    // Syrup per tap (if we have tap data)
    const syrupPerTap = totalTaps > 0 ? totalSyrupProduced / totalTaps : null;

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
      syrupPerTap: syrupPerTap ? Math.round(syrupPerTap * 1000) / 1000 : null,
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
   * Get weather correlation data with temperature history (previous 2 days)
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   */
  async getWeatherCorrelation(seasonId, lat, lng, temperatureUnit = 'fahrenheit') {
    const [collections, zones] = await Promise.all([
      collectionRepository.findBySeasonId(seasonId),
      zoneRepository.findBySeasonId(seasonId),
    ]);

    if (collections.length === 0) {
      return { data: [], correlation: null };
    }

    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    const dates = collections.map((c) => c.date.split('T')[0]);
    const startDate = dates.reduce((a, b) => (a < b ? a : b));
    const endDate = dates.reduce((a, b) => (a > b ? a : b));

    // Extend range backward by 2 days for previous-day temp history
    const extendedStart = (() => {
      const d = new Date(startDate);
      d.setDate(d.getDate() - 2);
      return d.toISOString().split('T')[0];
    })();

    const weather = await weatherService.getWeatherRange(lat, lng, extendedStart, endDate, temperatureUnit);
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));

    const collectionsByDate = new Map();
    for (const col of collections) {
      const date = col.date.split('T')[0];
      const existing = collectionsByDate.get(date) || 0;
      collectionsByDate.set(date, existing + (col.volume || 0));
    }

    const prevDate = (dateStr, offset) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() - offset);
      return d.toISOString().split('T')[0];
    };

    const data = [];
    for (const [date, volume] of collectionsByDate) {
      const w = weatherByDate.get(date);
      if (w) {
        const prev1 = weatherByDate.get(prevDate(date, 1));
        const prev2 = weatherByDate.get(prevDate(date, 2));
        data.push({
          date,
          volume,
          volumePerTap: totalTaps > 0 ? Math.round((volume / totalTaps) * 100) / 100 : null,
          tempHigh: w.tempHigh,
          tempLow: w.tempLow,
          tempDelta: w.tempHigh - w.tempLow,
          precipitation: w.precipitation,
          idealConditions: isSapFlowIdeal(w.tempHigh, w.tempLow, temperatureUnit),
          prevDayTempHigh: prev1?.tempHigh ?? null,
          prevDayTempLow: prev1?.tempLow ?? null,
          prevDay2TempHigh: prev2?.tempHigh ?? null,
          prevDay2TempLow: prev2?.tempLow ?? null,
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
      totalTaps: totalTaps || null,
    };
  }

  /**
   * Simple least-squares linear regression: beta = (X'X)^{-1} X'y
   * X: array of feature rows (each row same length), y: array of numbers
   * Returns { coefficients, intercept } where intercept is coefficients[0], or null if underdetermined
   */
  _linearRegression(X, y) {
    const n = X.length;
    const p = X[0].length;
    if (n < p) return null;

    const Xt = this._transpose(X);
    const XtX = this._matMul(Xt, X);
    const Xty = Xt.map((row) => row.reduce((sum, x, i) => sum + x * y[i], 0));
    const invXtX = this._inverse(XtX);
    if (!invXtX) return null;
    const beta = invXtX.map((row) => row.reduce((sum, a, j) => sum + a * Xty[j], 0));
    return { coefficients: beta, intercept: beta[0] };
  }

  _transpose(A) {
    const rows = A.length;
    const cols = A[0].length;
    const out = [];
    for (let j = 0; j < cols; j++) {
      out.push(A.map((row) => row[j]));
    }
    return out;
  }

  _matMul(A, B) {
    const rows = A.length;
    const inner = A[0].length;
    const cols = B[0].length;
    const out = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < inner; k++) sum += A[i][k] * B[k][j];
        row.push(sum);
      }
      out.push(row);
    }
    return out;
  }

  _inverse(A) {
    const n = A.length;
    const aug = A.map((row, i) => [...row, ...(Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)))]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
      }
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
      const div = aug[col][col];
      if (Math.abs(div) < 1e-10) return null;
      for (let j = 0; j < 2 * n; j++) aug[col][j] /= div;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = aug[row][col];
        for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
      }
    }
    return aug.map((row) => row.slice(n));
  }

  /**
   * Get flow predictions for the next 7 days using historical correlation and forecast
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   * Returns { predictions: [{ date, predictedVolume, tempHigh, tempLow, idealForSap }, ...], modelQuality?, insufficientData?: true }
   */
  async getFlowPredictions(seasonId, lat, lng, temperatureUnit = 'fahrenheit') {
    const [corr, zones] = await Promise.all([
      this.getWeatherCorrelation(seasonId, lat, lng, temperatureUnit),
      zoneRepository.findBySeasonId(seasonId),
    ]);
    if (corr.data.length < 3) {
      return { predictions: [], insufficientData: true, totalDays: corr.data.length };
    }

    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    const data = corr.data;
    const X = data.map((d) => [
      1,
      d.tempHigh,
      d.tempLow,
      d.tempDelta,
      d.prevDayTempHigh ?? d.tempHigh,
      d.prevDayTempLow ?? d.tempLow,
      d.idealConditions ? 1 : 0,
    ]);
    const y = data.map((d) => d.volume);

    const model = this._linearRegression(X, y);
    if (!model) {
      return { predictions: [], insufficientData: true, totalDays: data.length };
    }

    const forecast = await weatherService.getForecast(lat, lng, temperatureUnit);
    const forecastByDate = new Map(forecast.map((d) => [d.date, d]));

    const prevDate = (dateStr, offset) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() - offset);
      return d.toISOString().split('T')[0];
    };

    const predictions = [];
    for (let i = 0; i < forecast.length; i++) {
      const day = forecast[i];
      const date = day.date;
      const prev1 = forecastByDate.get(prevDate(date, 1)) ?? (i > 0 ? forecast[i - 1] : null);
      const tempHigh = day.tempHigh ?? 0;
      const tempLow = day.tempLow ?? 0;
      const tempDelta = tempHigh - tempLow;
      const prevHigh = prev1?.tempHigh ?? tempHigh;
      const prevLow = prev1?.tempLow ?? tempLow;
      const idealForSap = isSapFlowIdeal(tempHigh, tempLow, temperatureUnit);

      const feat = [1, tempHigh, tempLow, tempDelta, prevHigh, prevLow, idealForSap ? 1 : 0];
      let predictedVolume = model.intercept;
      for (let j = 1; j < model.coefficients.length; j++) {
        predictedVolume += model.coefficients[j] * feat[j];
      }
      predictedVolume = Math.max(0, Math.round(predictedVolume * 100) / 100);

      predictions.push({
        date,
        predictedVolume,
        predictedVolumePerTap: totalTaps > 0 ? Math.round((predictedVolume / totalTaps) * 100) / 100 : null,
        tempHigh,
        tempLow,
        idealForSap,
      });
    }

    const fitted = data.map((d, i) => {
      let v = model.intercept;
      for (let j = 1; j < model.coefficients.length; j++) {
        v += model.coefficients[j] * X[i][j];
      }
      return v;
    });
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0);
    const ssRes = y.reduce((sum, yi, i) => sum + (yi - fitted[i]) ** 2, 0);
    const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 100) / 100 : null;

    return {
      predictions,
      modelQuality: r2,
      totalDays: data.length,
      totalTaps: totalTaps || null,
    };
  }
}

export const statsService = new StatsServiceClass();
