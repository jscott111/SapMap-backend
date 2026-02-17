/**
 * Base Repository class for Firestore operations
 */

import { getDb, docToObject, dateToTimestamp } from '../firestore.js';

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

export class BaseRepository {
  constructor(collectionName) {
    this.collectionName = collectionName;
  }

  get collection() {
    return getDb().collection(this.collectionName);
  }

  /**
   * Create a new document
   */
  async create(data) {
    const now = dateToTimestamp(new Date());
    const docData = stripUndefined({
      ...data,
      createdAt: now,
      updatedAt: now,
    });

    const docRef = await this.collection.add(docData);
    const doc = await docRef.get();
    return docToObject(doc);
  }

  /**
   * Create a document with a specific ID
   */
  async createWithId(id, data) {
    const now = dateToTimestamp(new Date());
    const docData = stripUndefined({
      ...data,
      createdAt: now,
      updatedAt: now,
    });

    await this.collection.doc(id).set(docData);
    const doc = await this.collection.doc(id).get();
    return docToObject(doc);
  }

  /**
   * Find a document by ID
   */
  async findById(id) {
    const doc = await this.collection.doc(id).get();
    return docToObject(doc);
  }

  /**
   * Find all documents
   */
  async findAll() {
    const snapshot = await this.collection.get();
    return snapshot.docs.map(docToObject);
  }

  /**
   * Find documents by a field value
   */
  async findBy(field, value) {
    const snapshot = await this.collection.where(field, '==', value).get();
    return snapshot.docs.map(docToObject);
  }

  /**
   * Find documents by multiple conditions
   */
  async findByConditions(conditions) {
    let query = this.collection;
    for (const { field, operator, value } of conditions) {
      query = query.where(field, operator || '==', value);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(docToObject);
  }

  /**
   * Update a document
   */
  async update(id, data) {
    const updateData = stripUndefined({
      ...data,
      updatedAt: dateToTimestamp(new Date()),
    });

    await this.collection.doc(id).update(updateData);
    return this.findById(id);
  }

  /**
   * Delete a document
   */
  async delete(id) {
    await this.collection.doc(id).delete();
    return { success: true };
  }

  /**
   * Check if a document exists
   */
  async exists(id) {
    const doc = await this.collection.doc(id).get();
    return doc.exists;
  }
}
