/**
 * Zone Repository for managing collection zones
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class ZoneRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.ZONES);
  }

  /**
   * Find all zones for a season
   */
  async findBySeasonId(seasonId) {
    return this.findBy('seasonId', seasonId);
  }

  /**
   * Find all zones for a user
   */
  async findByUserId(userId) {
    return this.findBy('userId', userId);
  }

  /**
   * Get total tap count for a season
   */
  async getTotalTaps(seasonId) {
    const zones = await this.findBySeasonId(seasonId);
    return zones.reduce((total, zone) => total + (zone.tapCount || 0), 0);
  }
}

export const zoneRepository = new ZoneRepositoryClass();
