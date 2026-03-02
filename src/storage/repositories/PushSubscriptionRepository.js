/**
 * Push Subscription Repository for storing Web Push subscriptions per user/device
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections } from '../firestore.js';

class PushSubscriptionRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.PUSH_SUBSCRIPTIONS);
  }

  /**
   * Find all push subscriptions for a user
   */
  async findByUser(userId) {
    return this.findBy('userId', userId);
  }

  /**
   * Find a subscription by user and endpoint (for dedupe)
   */
  async findByUserAndEndpoint(userId, endpoint) {
    const list = await this.findByConditions([
      { field: 'userId', value: userId },
      { field: 'endpoint', value: endpoint },
    ]);
    return list[0] || null;
  }

  /**
   * Upsert a push subscription: create or update by userId + endpoint
   */
  async upsert(userId, subscription, userAgent = null) {
    const { endpoint, keys } = subscription;
    if (!endpoint || !keys) return null;

    const existing = await this.findByUserAndEndpoint(userId, endpoint);
    const payload = {
      userId,
      endpoint,
      keys: keys || {},
      userAgent: userAgent || null,
    };

    if (existing) {
      return this.update(existing.id, payload);
    }
    return this.create(payload);
  }

  /**
   * Delete a subscription by endpoint (and optionally userId for security)
   */
  async deleteByEndpoint(endpoint, userId = null) {
    let query = this.collection.where('endpoint', '==', endpoint);
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    const snapshot = await query.get();
    if (snapshot.empty) return { deleted: 0 };
    await Promise.all(snapshot.docs.map((d) => this.delete(d.id)));
    return { deleted: snapshot.size };
  }
}

export const pushSubscriptionRepository = new PushSubscriptionRepositoryClass();
