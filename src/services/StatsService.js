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

/** In-memory cache for getDetailedWeatherCorrelation to avoid duplicate archive calls (e.g. when flow-predictions runs in parallel). TTL in ms. */
const DETAILED_CORRELATION_CACHE_TTL_MS = 90 * 1000;
const detailedCorrelationCache = new Map();
/** In-flight requests: same key awaits the same promise so only one archive call runs when both endpoints are hit in parallel. */
const detailedCorrelationPending = new Map();

function detailedCorrelationCacheKey(seasonId, lat, lng, temperatureUnit) {
  return `${seasonId}|${Number(lat)}|${Number(lng)}|${temperatureUnit || 'fahrenheit'}`;
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
   * Calculate Pearson correlation coefficient between two arrays
   * Returns { coefficient, strength } where strength is 'strong'|'moderate'|'weak'|'none'
   */
  _calculateCorrelation(xValues, yValues) {
    const validPairs = xValues
      .map((x, i) => [x, yValues[i]])
      .filter(([x, y]) => x != null && y != null && !isNaN(x) && !isNaN(y));

    if (validPairs.length < 3) {
      return { coefficient: null, strength: 'none', sampleSize: validPairs.length };
    }

    const xs = validPairs.map(([x]) => x);
    const ys = validPairs.map(([, y]) => y);

    const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < xs.length; i++) {
      const xDev = xs[i] - avgX;
      const yDev = ys[i] - avgY;
      numerator += xDev * yDev;
      denomX += xDev ** 2;
      denomY += yDev ** 2;
    }

    const denominator = Math.sqrt(denomX * denomY);
    if (denominator === 0) {
      return { coefficient: null, strength: 'none', sampleSize: xs.length };
    }

    const coefficient = Math.round((numerator / denominator) * 100) / 100;
    const absCoef = Math.abs(coefficient);

    let strength;
    if (absCoef >= 0.5) {
      strength = 'strong';
    } else if (absCoef >= 0.3) {
      strength = 'moderate';
    } else if (absCoef >= 0.1) {
      strength = 'weak';
    } else {
      strength = 'none';
    }

    return { coefficient, strength, sampleSize: xs.length };
  }

  /**
   * Get detailed weather correlation data with all weather factors
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   */
  async getDetailedWeatherCorrelation(seasonId, lat, lng, temperatureUnit = 'fahrenheit') {
    const key = detailedCorrelationCacheKey(seasonId, lat, lng, temperatureUnit);
    const cached = detailedCorrelationCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const pending = detailedCorrelationPending.get(key);
    if (pending) {
      return pending;
    }

    const promise = this._computeDetailedWeatherCorrelation(seasonId, lat, lng, temperatureUnit, key);
    detailedCorrelationPending.set(key, promise);
    try {
      return await promise;
    } finally {
      detailedCorrelationPending.delete(key);
    }
  }

  async _computeDetailedWeatherCorrelation(seasonId, lat, lng, temperatureUnit, key) {
    const [collections, zones] = await Promise.all([
      collectionRepository.findBySeasonId(seasonId),
      zoneRepository.findBySeasonId(seasonId),
    ]);

    console.log(`[DEBUG] getDetailedWeatherCorrelation: seasonId=${seasonId}, collections=${collections.length}, zones=${zones.length}`);

    if (collections.length === 0) {
      return { data: [], correlations: {}, insights: [], totalDays: 0, totalTaps: null };
    }

    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    const dates = collections.map((c) => c.date.split('T')[0]);
    console.log(`[DEBUG] Collection dates (first 5): ${dates.slice(0, 5).join(', ')}`);
    const startDate = dates.reduce((a, b) => (a < b ? a : b));
    const endDate = dates.reduce((a, b) => (a > b ? a : b));
    console.log(`[DEBUG] Date range: ${startDate} to ${endDate}`);

    const extendedStart = (() => {
      const d = new Date(startDate);
      d.setDate(d.getDate() - 2);
      return d.toISOString().split('T')[0];
    })();

    const weather = await weatherService.getWeatherRange(lat, lng, extendedStart, endDate, temperatureUnit);
    console.log(`[DEBUG] Weather data count: ${weather.length}`);
    if (weather.length > 0) {
      console.log(`[DEBUG] Weather dates sample: ${weather.slice(0, 3).map(w => w.date).join(', ')}`);
    }
    const weatherByDate = new Map(weather.map((w) => [w.date, w]));

    const collectionsByDate = new Map();
    for (const col of collections) {
      const date = col.date.split('T')[0];
      const existing = collectionsByDate.get(date) || 0;
      collectionsByDate.set(date, existing + (col.volume || 0));
    }
    console.log(`[DEBUG] Unique collection dates: ${collectionsByDate.size}`);
    console.log(`[DEBUG] Collection dates sample: ${[...collectionsByDate.keys()].slice(0, 5).join(', ')}`);

    const prevDate = (dateStr, offset) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() - offset);
      return d.toISOString().split('T')[0];
    };

    const data = [];
    let noMatchDates = [];
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
          precipitationHours: w.precipitationHours ?? null,
          humidity: w.humidity ?? null,
          pressure: w.pressure ?? null,
          windSpeed: w.windSpeed ?? null,
          windDirection: w.windDirection ?? null,
          sunshineHours: w.sunshineHours ?? null,
          solarRadiation: w.solarRadiation ?? null,
          idealConditions: isSapFlowIdeal(w.tempHigh, w.tempLow, temperatureUnit),
          prevDayTempHigh: prev1?.tempHigh ?? null,
          prevDayTempLow: prev1?.tempLow ?? null,
          prevDayTempDelta: prev1 ? prev1.tempHigh - prev1.tempLow : null,
          prevDayIdeal: prev1 ? isSapFlowIdeal(prev1.tempHigh, prev1.tempLow, temperatureUnit) : null,
          prevDay2TempHigh: prev2?.tempHigh ?? null,
          prevDay2TempLow: prev2?.tempLow ?? null,
        });
      } else {
        noMatchDates.push(date);
      }
    }
    console.log(`[DEBUG] Matched data entries: ${data.length}, unmatched dates: ${noMatchDates.length}`);
    if (noMatchDates.length > 0) {
      console.log(`[DEBUG] Unmatched dates sample: ${noMatchDates.slice(0, 5).join(', ')}`);
    }

    const sortedData = data.sort((a, b) => a.date.localeCompare(b.date));
    const volumes = sortedData.map((d) => d.volume);

    const correlations = {
      tempDelta: this._calculateCorrelation(sortedData.map((d) => d.tempDelta), volumes),
      tempHigh: this._calculateCorrelation(sortedData.map((d) => d.tempHigh), volumes),
      tempLow: this._calculateCorrelation(sortedData.map((d) => d.tempLow), volumes),
      precipitation: this._calculateCorrelation(sortedData.map((d) => d.precipitation), volumes),
      humidity: this._calculateCorrelation(sortedData.map((d) => d.humidity), volumes),
      pressure: this._calculateCorrelation(sortedData.map((d) => d.pressure), volumes),
      windSpeed: this._calculateCorrelation(sortedData.map((d) => d.windSpeed), volumes),
      sunshineHours: this._calculateCorrelation(sortedData.map((d) => d.sunshineHours), volumes),
      prevDayTempDelta: this._calculateCorrelation(sortedData.map((d) => d.prevDayTempDelta), volumes),
      prevDayIdeal: this._calculateCorrelation(
        sortedData.map((d) => (d.prevDayIdeal === true ? 1 : d.prevDayIdeal === false ? 0 : null)),
        volumes
      ),
    };

    const insights = [];
    const insightMessages = {
      tempDelta: {
        positive: 'Larger temperature swings correlate with higher sap flow',
        negative: 'Smaller temperature swings correlate with higher sap flow',
      },
      tempHigh: {
        positive: 'Warmer daytime highs correlate with more sap production',
        negative: 'Cooler daytime highs correlate with more sap production',
      },
      tempLow: {
        positive: 'Warmer overnight lows correlate with higher yields',
        negative: 'Colder overnight lows correlate with higher yields',
      },
      precipitation: {
        positive: 'Precipitation correlates with increased flow',
        negative: 'Dry days correlate with higher sap flow',
      },
      humidity: {
        positive: 'Higher humidity correlates with more sap production',
        negative: 'Lower humidity correlates with better yields',
      },
      pressure: {
        positive: 'High pressure systems correlate with better flow',
        negative: 'Low pressure systems correlate with better flow',
      },
      windSpeed: {
        positive: 'Windier days correlate with higher yields',
        negative: 'Calm days correlate with better sap flow',
      },
      sunshineHours: {
        positive: 'Sunnier days correlate with more sap production',
        negative: 'Cloudier days correlate with better yields',
      },
      prevDayTempDelta: {
        positive: 'A large temperature swing the previous day predicts good flow',
        negative: 'Stable temperatures the previous day predict better flow',
      },
      prevDayIdeal: {
        positive: 'Ideal conditions the previous day predict good flow the next day',
        negative: 'Non-ideal previous days surprisingly predict better flow',
      },
    };

    for (const [factor, corr] of Object.entries(correlations)) {
      if (corr.strength === 'strong' || corr.strength === 'moderate') {
        const direction = corr.coefficient > 0 ? 'positive' : 'negative';
        const message = insightMessages[factor]?.[direction];
        if (message) {
          insights.push({
            factor,
            coefficient: corr.coefficient,
            strength: corr.strength,
            message,
          });
        }
      }
    }

    insights.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

    const result = {
      data: sortedData,
      correlations,
      insights,
      totalDays: sortedData.length,
      totalTaps: totalTaps || null,
      idealDaysCount: sortedData.filter((d) => d.idealConditions).length,
    };

    detailedCorrelationCache.set(key, {
      result,
      expiresAt: Date.now() + DETAILED_CORRELATION_CACHE_TTL_MS,
    });

    return result;
  }

  /**
   * Get flow predictions for the next 7 days using historical correlation and forecast
   * Uses enhanced weather features when available
   * @param {string} [temperatureUnit] - 'fahrenheit' or 'celsius'
   * @param {object} [precomputedCorrelation] - optional result from getDetailedWeatherCorrelation to avoid refetching
   * Returns { predictions: [{ date, predictedVolume, tempHigh, tempLow, idealForSap }, ...], modelQuality?, insufficientData?: true }
   */
  async getFlowPredictions(seasonId, lat, lng, temperatureUnit = 'fahrenheit', precomputedCorrelation = null) {
    const detailedCorr = precomputedCorrelation ?? await this.getDetailedWeatherCorrelation(seasonId, lat, lng, temperatureUnit);
    const zones = await zoneRepository.findBySeasonId(seasonId);

    if (detailedCorr.data.length < 3) {
      console.log('[DEBUG] getFlowPredictions: insufficient data, only', detailedCorr.data.length, 'days');
      return { predictions: [], insufficientData: true, totalDays: detailedCorr.data.length };
    }

    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    const data = detailedCorr.data;
    const correlations = detailedCorr.correlations || {};

    const hasValidData = (field) => {
      const corr = correlations[field];
      return corr && corr.coefficient != null && corr.sampleSize >= 3;
    };

    const useSunshine = hasValidData('sunshineHours') && 
      (correlations.sunshineHours.strength === 'strong' || correlations.sunshineHours.strength === 'moderate');
    const usePressure = hasValidData('pressure') &&
      (correlations.pressure.strength === 'strong' || correlations.pressure.strength === 'moderate');
    const useHumidity = hasValidData('humidity') &&
      (correlations.humidity.strength === 'strong' || correlations.humidity.strength === 'moderate');
    const useWindSpeed = hasValidData('windSpeed') &&
      (correlations.windSpeed.strength === 'strong' || correlations.windSpeed.strength === 'moderate');

    const avgSunshine = useSunshine 
      ? data.reduce((sum, d) => sum + (d.sunshineHours || 0), 0) / data.length 
      : 0;
    const avgPressure = usePressure 
      ? data.reduce((sum, d) => sum + (d.pressure || 0), 0) / data.length 
      : 0;
    const avgHumidity = useHumidity 
      ? data.reduce((sum, d) => sum + (d.humidity || 0), 0) / data.length 
      : 0;
    const avgWindSpeed = useWindSpeed 
      ? data.reduce((sum, d) => sum + (d.windSpeed || 0), 0) / data.length 
      : 0;

    const featureNames = ['intercept', 'tempHigh', 'tempLow', 'tempDelta', 'prevDayTempHigh', 'prevDayTempLow', 'idealConditions'];
    if (useSunshine) featureNames.push('sunshineHours');
    if (usePressure) featureNames.push('pressure');
    if (useHumidity) featureNames.push('humidity');
    if (useWindSpeed) featureNames.push('windSpeed');

    const buildFullFeatureRow = (d, useFallbacks = true) => {
      const row = [
        1,
        d.tempHigh,
        d.tempLow,
        d.tempDelta,
        d.prevDayTempHigh ?? (useFallbacks ? d.tempHigh : 0),
        d.prevDayTempLow ?? (useFallbacks ? d.tempLow : 0),
        d.idealConditions ? 1 : 0,
      ];
      if (useSunshine) row.push(d.sunshineHours ?? avgSunshine);
      if (usePressure) row.push(d.pressure ?? avgPressure);
      if (useHumidity) row.push(d.humidity ?? avgHumidity);
      if (useWindSpeed) row.push(d.windSpeed ?? avgWindSpeed);
      return row;
    };

    const XFull = data.map((d) => buildFullFeatureRow(d));
    const y = data.map((d) => d.volume);

    const colVariances = XFull[0].map((_, colIdx) => {
      const col = XFull.map(row => row[colIdx]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      return col.reduce((sum, v) => sum + (v - mean) ** 2, 0) / col.length;
    });

    const keptCols = colVariances
      .map((variance, idx) => (idx === 0 || variance > 1e-10) ? idx : -1)
      .filter(idx => idx >= 0);

    console.log('[DEBUG] getFlowPredictions: n=', data.length, 'fullCols=', XFull[0].length, 'keptCols=', keptCols.length, 'featureNames=', featureNames);
    console.log('[DEBUG] Column variances:', colVariances.map((v, i) => `${featureNames[i]}=${v.toFixed(4)}`).join(', '));

    const X = XFull.map(row => keptCols.map(idx => row[idx]));
    const keptFeatureNames = keptCols.map(idx => featureNames[idx]);

    console.log('[DEBUG] Kept features:', keptFeatureNames.join(', '));

    let model = this._linearRegression(X, y);

    if (!model) {
      console.log('[DEBUG] getFlowPredictions: primary regression failed (singular matrix), trying minimal fallback');
      const XMinimal = data.map((d) => [1, d.tempHigh, d.tempLow]);
      model = this._linearRegression(XMinimal, y);
      if (!model) {
        console.log('[DEBUG] getFlowPredictions: minimal regression also failed');
        return { predictions: [], insufficientData: true, totalDays: data.length };
      }
      console.log('[DEBUG] getFlowPredictions: minimal fallback succeeded with 3 features');
      const forecast = await weatherService.getForecast(lat, lng, temperatureUnit);
      const predictions = forecast.map((day) => {
        const tempHigh = day.tempHigh ?? 0;
        const tempLow = day.tempLow ?? 0;
        const feat = [1, tempHigh, tempLow];
        let predictedVolume = model.coefficients.reduce((sum, c, j) => sum + c * feat[j], 0);
        predictedVolume = Math.max(0, Math.round(predictedVolume * 100) / 100);
        return {
          date: day.date,
          predictedVolume,
          predictedVolumePerTap: totalTaps > 0 ? Math.round((predictedVolume / totalTaps) * 100) / 100 : null,
          tempHigh,
          tempLow,
          idealForSap: isSapFlowIdeal(tempHigh, tempLow, temperatureUnit),
        };
      });
      const fittedMin = data.map((d) => model.coefficients[0] + model.coefficients[1] * d.tempHigh + model.coefficients[2] * d.tempLow);
      const meanY = y.reduce((a, b) => a + b, 0) / y.length;
      const ssTot = y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0);
      const ssRes = y.reduce((sum, yi, i) => sum + (yi - fittedMin[i]) ** 2, 0);
      const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 100) / 100 : null;
      return {
        predictions,
        modelQuality: r2,
        totalDays: data.length,
        totalTaps: totalTaps || null,
        featuresUsed: ['tempHigh', 'tempLow'],
      };
    }

    console.log('[DEBUG] getFlowPredictions: regression succeeded, coefficients count=', model.coefficients.length);

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

      const fullFeat = [1, tempHigh, tempLow, tempDelta, prevHigh, prevLow, idealForSap ? 1 : 0];
      if (useSunshine) fullFeat.push(day.sunshineHours ?? avgSunshine);
      if (usePressure) fullFeat.push(day.pressure ?? avgPressure);
      if (useHumidity) fullFeat.push(day.humidity ?? avgHumidity);
      if (useWindSpeed) fullFeat.push(day.windSpeed ?? avgWindSpeed);

      const feat = keptCols.map(idx => fullFeat[idx]);

      let predictedVolume = 0;
      for (let j = 0; j < model.coefficients.length; j++) {
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
      let v = 0;
      for (let j = 0; j < model.coefficients.length; j++) {
        v += model.coefficients[j] * X[i][j];
      }
      return v;
    });
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0);
    const ssRes = y.reduce((sum, yi, i) => sum + (yi - fitted[i]) ** 2, 0);
    const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 100) / 100 : null;

    const featuresUsed = keptFeatureNames.filter(n => n !== 'intercept');

    return {
      predictions,
      modelQuality: r2,
      totalDays: data.length,
      totalTaps: totalTaps || null,
      featuresUsed,
    };
  }

  /**
   * Generate conventional flow estimates: which days are ideal is determined only by the
   * freeze-thaw rule (cold nights + warm days). On ideal days, estimated volume uses your
   * average collection on ideal days; on non-ideal days, 0.
   */
  async getTraditionalFlowPredictions(seasonId, lat, lng, temperatureUnit = 'fahrenheit', precomputedCorrelation = null) {
    const detailedCorr = precomputedCorrelation ?? await this.getDetailedWeatherCorrelation(seasonId, lat, lng, temperatureUnit);
    const zones = await zoneRepository.findBySeasonId(seasonId);
    const totalTaps = zones.reduce((t, z) => t + (z.tapCount || 0), 0);

    const data = detailedCorr.data || [];
    const idealDays = data.filter((d) => d.idealConditions);
    const avgIdealVolume = idealDays.length > 0
      ? idealDays.reduce((sum, d) => sum + d.volume, 0) / idealDays.length
      : null;

    const forecast = await weatherService.getForecast(lat, lng, temperatureUnit);

    const predictions = forecast.map((day) => {
      const tempHigh = day.tempHigh ?? 0;
      const tempLow = day.tempLow ?? 0;
      const idealForSap = isSapFlowIdeal(tempHigh, tempLow, temperatureUnit);

      let predictedVolume = 0;
      if (idealForSap && avgIdealVolume != null) {
        predictedVolume = Math.round(avgIdealVolume * 100) / 100;
      }

      return {
        date: day.date,
        predictedVolume,
        predictedVolumePerTap: totalTaps > 0 ? Math.round((predictedVolume / totalTaps) * 100) / 100 : null,
        tempHigh,
        tempLow,
        idealForSap,
      };
    });

    return {
      predictions,
      method: 'traditional',
      description: 'Ideal vs non-ideal from the freeze-thaw rule (cold nights + warm days). Volume on ideal days uses your average collection on ideal days.',
      totalDays: data.length,
      totalTaps: totalTaps || null,
      insufficientData: predictions.length === 0 || avgIdealVolume == null,
    };
  }
}

export const statsService = new StatsServiceClass();
