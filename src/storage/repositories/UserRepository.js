/**
 * User Repository for managing user accounts
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections, dateToTimestamp } from '../firestore.js';

class UserRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.USERS);
  }

  /**
   * Find a user by email
   */
  async findByEmail(email) {
    const users = await this.findBy('email', email.toLowerCase());
    return users[0] || null;
  }

  /**
   * Create a new user
   */
  async create(userData) {
    const data = {
      ...userData,
      email: userData.email.toLowerCase(),
      preferences: userData.preferences || {
        units: 'gallons',
        temperatureUnit: 'fahrenheit',
        timezone: 'America/New_York',
        unitOnboardingCompleted: false,
      },
      legalConsent: userData.legalConsent || null,
    };
    return super.create(data);
  }

  /**
   * Record legal consent (ToS and Privacy Policy) for a user
   */
  async recordConsent(userId, { tosVersion, privacyVersion, ip, userAgent }) {
    const now = dateToTimestamp(new Date());
    const legalConsent = {
      tosAcceptedAt: now,
      tosVersion,
      privacyAcceptedAt: now,
      privacyVersion,
      ...(ip != null && { consentIp: ip }),
      ...(userAgent != null && { consentUserAgent: userAgent }),
    };
    return this.update(userId, { legalConsent });
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId, preferences) {
    return this.update(userId, { preferences });
  }

  /**
   * Update user password (e.g. after reset)
   */
  async updatePassword(userId, passwordHash) {
    return this.update(userId, { passwordHash });
  }
}

export const userRepository = new UserRepositoryClass();
