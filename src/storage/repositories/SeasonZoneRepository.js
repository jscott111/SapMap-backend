/**
 * SeasonZone Repository - per-season zone inclusion and tap count override
 * One document per (seasonId, zoneId). Composite id: seasonId_zoneId
 */

import { getDb, docToObject, dateToTimestamp } from '../firestore.js';
import { Collections } from '../firestore.js';

function docId(seasonId, zoneId) {
  return `${seasonId}_${zoneId}`;
}

/** Remove undefined values so Firestore doesn't reject the document */
function stripUndefined(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const isPlainObject =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      typeof value.toDate !== 'function';
    out[key] = isPlainObject ? stripUndefined(value) : value;
  }
  return out;
}

class SeasonZoneRepositoryClass {
  get collection() {
    return getDb().collection(Collections.SEASON_ZONES);
  }

  /**
   * Find all seasonZone documents for a season
   * @returns {Promise<Array<{ id, seasonId, zoneId, tapCount?, included: boolean }>>}
   */
  async findBySeasonId(seasonId) {
    const snapshot = await this.collection.where('seasonId', '==', seasonId).get();
    return snapshot.docs.map(docToObject);
  }

  /**
   * Find all seasonZone documents for a zone (any season)
   * @returns {Promise<Array<{ id, seasonId, zoneId, tapCount?, included: boolean }>>}
   */
  async findByZoneId(zoneId) {
    const snapshot = await this.collection.where('zoneId', '==', zoneId).get();
    return snapshot.docs.map(docToObject);
  }

  /**
   * Get a single seasonZone by seasonId and zoneId
   * @returns {Promise<{ id, seasonId, zoneId, tapCount?, included: boolean } | null>}
   */
  async get(seasonId, zoneId) {
    const id = docId(seasonId, zoneId);
    const doc = await this.collection.doc(id).get();
    return docToObject(doc);
  }

  /**
   * Create or update seasonZone for (seasonId, zoneId).
   * @param {string} seasonId
   * @param {string} zoneId
   * @param {{ tapCount?: number, included?: boolean }} data
   * @returns {Promise<{ id, seasonId, zoneId, tapCount?, included: boolean }>}
   */
  async set(seasonId, zoneId, data) {
    const id = docId(seasonId, zoneId);
    const now = dateToTimestamp(new Date());
    const docRef = this.collection.doc(id);
    const existing = await docRef.get();

    const payload = stripUndefined({
      seasonId,
      zoneId,
      ...(data.tapCount !== undefined && { tapCount: data.tapCount }),
      ...(data.included !== undefined && { included: data.included }),
    });

    if (existing.exists) {
      const updateData = stripUndefined({
        ...payload,
        updatedAt: now,
      });
      await docRef.update(updateData);
    } else {
      const createData = stripUndefined({
        ...payload,
        included: data.included !== undefined ? data.included : true,
        createdAt: now,
        updatedAt: now,
      });
      await docRef.set(createData);
    }

    const doc = await docRef.get();
    return docToObject(doc);
  }

  /**
   * Delete seasonZone document (revert to no override: included with zone.tapCount)
   */
  async delete(seasonId, zoneId) {
    const id = docId(seasonId, zoneId);
    await this.collection.doc(id).delete();
    return { success: true };
  }
}

export const seasonZoneRepository = new SeasonZoneRepositoryClass();
