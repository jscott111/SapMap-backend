/**
 * Notification Repository for storing and querying user notifications
 */

import { BaseRepository } from './BaseRepository.js';
import { Collections, getDb, docToObject, dateToTimestamp } from '../firestore.js';

class NotificationRepositoryClass extends BaseRepository {
  constructor() {
    super(Collections.NOTIFICATIONS);
  }

  /**
   * Create a notification for a user
   */
  async createForUser(userId, data) {
    return this.create({
      userId,
      operationId: data.operationId ?? null,
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      data: data.data ?? null,
      read: false,
    });
  }

  /**
   * Find notifications for a user with optional filters and pagination.
   * Filters read/operationId in memory to avoid Firestore composite indexes.
   */
  async findByUser(userId, options = {}) {
    const { read = null, operationId = null, limit = 50, beforeId = null } = options;
    let query = this.collection
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(beforeId ? limit + 1 : 200);

    if (beforeId) {
      const beforeDoc = await this.collection.doc(beforeId).get();
      if (beforeDoc.exists) {
        query = query.startAfter(beforeDoc);
      }
    }

    const snapshot = await query.get();
    let list = snapshot.docs.map(docToObject);

    if (read !== null && read !== undefined) {
      list = list.filter((n) => n.read === !!read);
    }
    if (operationId) {
      list = list.filter((n) => n.operationId === operationId);
    }

    return list.slice(0, limit);
  }

  /**
   * Mark a single notification as read
   */
  async markRead(id, userId) {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data.userId !== userId) return null;
    return this.update(id, { read: true });
  }

  /**
   * Mark all notifications for a user as read (optional operationId filter)
   */
  async markAllRead(userId, operationId = null) {
    let query = this.collection.where('userId', '==', userId).where('read', '==', false);
    if (operationId) {
      query = query.where('operationId', '==', operationId);
    }
    const snapshot = await query.get();
    const batch = getDb().batch();
    const now = dateToTimestamp(new Date());
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { read: true, updatedAt: now });
    }
    if (snapshot.empty) return { count: 0 };
    await batch.commit();
    return { count: snapshot.size };
  }
}

export const notificationRepository = new NotificationRepositoryClass();
