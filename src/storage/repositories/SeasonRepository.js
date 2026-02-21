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
   * Find all seasons for a user (personal only)
   */
  async findByUserId(userId) {
    const seasons = await this.findBy('userId', userId);
    return seasons.sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  /**
   * Find all seasons for an organization
   */
  async findByOrganizationId(organizationId) {
    const seasons = await this.findBy('organizationId', organizationId);
    return seasons.sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  /**
   * Find all seasons accessible to user (personal + org memberships)
   */
  async findAccessibleByUser(userId, memberships = []) {
    const personal = await this.findByUserId(userId);
    const orgIds = [...new Set((memberships || []).map((m) => m.organizationId))];
    let orgSeasons = [];
    for (const orgId of orgIds) {
      const list = await this.findByOrganizationId(orgId);
      orgSeasons = orgSeasons.concat(list);
    }
    const byId = new Map();
    for (const s of [...personal, ...orgSeasons]) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
    return [...byId.values()].sort((a, b) => (b.year || 0) - (a.year || 0));
  }

  /**
   * Find the active season for a user (among accessible seasons)
   */
  async findActiveSeason(userId, memberships = []) {
    const seasons = await this.findAccessibleByUser(userId, memberships);
    return seasons.find((s) => s.isActive) || null;
  }

  /**
   * Set a season as active (deactivates other accessible seasons for this user)
   */
  async setActive(seasonId, userId, memberships = []) {
    const seasons = await this.findAccessibleByUser(userId, memberships);
    const canActivate = seasons.some((s) => s.id === seasonId);
    if (!canActivate) {
      const err = new Error('Season not found or access denied');
      err.statusCode = 404;
      throw err;
    }
    for (const season of seasons) {
      if (season.id !== seasonId && season.isActive) {
        await this.update(season.id, { isActive: false });
      }
    }
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
