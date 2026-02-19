/**
 * Collection Repository for managing sap collection records
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections, getDb } from '../firestore.js';

class CollectionRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.COLLECTIONS);
  }

  /**
   * Find all collections for a season
   */
  async findBySeasonId(seasonId) {
    const collections = await this.findBy('seasonId', seasonId);
    return collections.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Find collections for a specific zone
   */
  async findByZoneId(zoneId) {
    const collections = await this.findBy('zoneId', zoneId);
    return collections.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Find collections for a date range
   */
  async findByDateRange(seasonId, startDate, endDate) {
    const snapshot = await this.collection
      .where('seasonId', '==', seasonId)
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .orderBy('date', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Get total volume for a season (liters)
   */
  async getTotalVolume(seasonId) {
    const collections = await this.findBySeasonId(seasonId);
    return collections.reduce((total, col) => total + (col.volume || 0), 0);
  }

  /**
   * Get daily totals for a season
   */
  async getDailyTotals(seasonId) {
    const collections = await this.findBySeasonId(seasonId);
    const dailyMap = new Map();

    for (const col of collections) {
      const date = col.date.split('T')[0];
      const existing = dailyMap.get(date) || { date, volume: 0, count: 0 };
      existing.volume += col.volume || 0;
      existing.count += 1;
      dailyMap.set(date, existing);
    }

    return Array.from(dailyMap.values()).sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
  }
}

export const collectionRepository = new CollectionRepositoryClass();
