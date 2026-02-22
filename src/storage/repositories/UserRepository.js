/**
 * User Repository for managing user accounts
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

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
      },
    };
    return super.create(data);
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
