/**
 * Password Reset Token Repository for one-time reset links
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

const RESET_EXPIRY_HOURS = 1;

class PasswordResetTokenRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.PASSWORD_RESET_TOKENS);
  }

  /**
   * Create a reset token for a user
   */
  async createToken(userId, token) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + RESET_EXPIRY_HOURS);
    return this.create({
      userId,
      token,
      expiresAt,
    });
  }

  /**
   * Find reset record by token
   */
  async findByToken(token) {
    const list = await this.findBy('token', token);
    return list[0] || null;
  }

  /**
   * Check if reset record is expired
   */
  isExpired(record) {
    if (!record || !record.expiresAt) return true;
    const expiresAt =
      typeof record.expiresAt === 'string' ? new Date(record.expiresAt) : record.expiresAt;
    return expiresAt < new Date();
  }
}

export const passwordResetTokenRepository = new PasswordResetTokenRepositoryClass();
