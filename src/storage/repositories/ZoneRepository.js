/**
 * Zone Repository (Sugar Bush) - org-scoped, can span seasons
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class ZoneRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.ZONES);
  }

  /**
   * Find all zones for an organization
   */
  async findByOrganizationId(organizationId) {
    return this.findBy('organizationId', organizationId);
  }

  /**
   * Find all zones for a season (legacy: zones may have seasonId before migration)
   */
  async findBySeasonId(seasonId) {
    return this.findBy('seasonId', seasonId);
  }

  /**
   * Find all zones for a user (legacy)
   */
  async findByUserId(userId) {
    return this.findBy('userId', userId);
  }

  /**
   * Get total tap count for an organization's zones
   */
  async getTotalTapsForOrg(organizationId) {
    const zones = await this.findByOrganizationId(organizationId);
    return zones.reduce((total, zone) => total + (zone.tapCount || 0), 0);
  }
}

export const zoneRepository = new ZoneRepositoryClass();
