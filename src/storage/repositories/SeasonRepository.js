/**
 * Season Repository for managing sugaring seasons
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class SeasonRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.SEASONS);
  }

  /**
   * Find all seasons for a user
   */
  async findByUserId(userId) {
    const seasons = await this.findBy('userId', userId);
    return seasons.sort((a, b) => b.year - a.year);
  }

  /**
   * Find the active season for a user
   */
  async findActiveSeason(userId) {
    const seasons = await this.findByConditions([
      { field: 'userId', value: userId },
      { field: 'isActive', value: true },
    ]);
    return seasons[0] || null;
  }

  /**
   * Set a season as active (deactivates others)
   */
  async setActive(seasonId, userId) {
    // Deactivate all other seasons for this user
    const seasons = await this.findByUserId(userId);
    for (const season of seasons) {
      if (season.id !== seasonId && season.isActive) {
        await this.update(season.id, { isActive: false });
      }
    }

    // Activate the specified season
    return this.update(seasonId, { isActive: true });
  }

  /**
   * Create a new season
   */
  async create(data) {
    const seasonData = {
      ...data,
      isActive: data.isActive ?? true,
      year: data.year || new Date().getFullYear(),
    };
    return super.create(seasonData);
  }
}

export const seasonRepository = new SeasonRepositoryClass();
