/**
 * Boil Repository for managing boiling/evaporation records
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class BoilRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.BOILS);
  }

  /**
   * Find all boils for a season
   */
  async findBySeasonId(seasonId) {
    const boils = await this.findBy('seasonId', seasonId);
    return boils.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Get total syrup produced for a season
   */
  async getTotalSyrup(seasonId) {
    const boils = await this.findBySeasonId(seasonId);
    return boils.reduce((total, boil) => total + (boil.syrupVolumeOut || 0), 0);
  }

  /**
   * Get total sap processed for a season
   */
  async getTotalSapProcessed(seasonId) {
    const boils = await this.findBySeasonId(seasonId);
    return boils.reduce((total, boil) => total + (boil.sapVolumeIn || 0), 0);
  }

  /**
   * Calculate average yield ratio for a season
   */
  async getAverageYieldRatio(seasonId) {
    const boils = await this.findBySeasonId(seasonId);
    const validBoils = boils.filter(
      (b) => b.sapVolumeIn > 0 && b.syrupVolumeOut > 0
    );

    if (validBoils.length === 0) return null;

    const totalSap = validBoils.reduce((t, b) => t + b.sapVolumeIn, 0);
    const totalSyrup = validBoils.reduce((t, b) => t + b.syrupVolumeOut, 0);

    return totalSap / totalSyrup;
  }
}

export const boilRepository = new BoilRepositoryClass();
