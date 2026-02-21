/**
 * Firestore database initialization and utilities
 *
 * Production (Cloud Run): uses Application Default Credentials only.
 * Local development: use GOOGLE_APPLICATION_CREDENTIALS pointing to a key file,
 * or Firestore emulator via FIRESTORE_EMULATOR_HOST.
 */

import { Firestore } from '@google-cloud/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

/**
 * Initialize and return Firestore client
 */
export const initFirestore = async () => {
  if (db) {
    return db;
  }

  try {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const useEmulator = process.env.FIRESTORE_EMULATOR_HOST;
    const isProduction = process.env.NODE_ENV === 'production';

    if (useEmulator) {
      console.log(`🔧 Connecting to Firestore Emulator at ${useEmulator}`);
      db = new Firestore({
        projectId: projectId || 'demo-sapmap',
      });
    } else if (isProduction) {
      if (!projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID is required in production');
      }
      console.log('🔧 Using Application Default Credentials for Firestore');
      db = new Firestore({ projectId });
    } else {
      // Development with real Firestore
      const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (keyPath && fs.existsSync(keyPath)) {
        console.log('🔧 Using credentials file for Firestore');
        db = new Firestore({
          projectId: projectId || 'sapmap-dev',
          keyFilename: keyPath,
        });
      } else {
        console.log('🔧 Using Application Default Credentials for Firestore (development)');
        db = new Firestore({
          projectId: projectId || 'sapmap-dev',
        });
      }
    }

    // Test connection
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
      );

      await Promise.race([
        db.collection('_health').limit(1).get(),
        timeoutPromise,
      ]);

      console.log('✅ Connected to Firestore');
    } catch (connectionError) {
      if (useEmulator) {
        console.error('❌ Failed to connect to Firestore Emulator');
        console.error('   Start the emulator: firebase emulators:start --only firestore');
        throw new Error('Firestore emulator not available');
      }
      throw connectionError;
    }

    return db;
  } catch (error) {
    console.error('❌ Firestore initialization failed:', error.message);
    throw error;
  }
};

/**
 * Get the Firestore database instance
 */
export const getDb = () => {
  if (!db) {
    throw new Error('Firestore not initialized. Call initFirestore() first.');
  }
  return db;
};

/**
 * Collection names as constants
 */
export const Collections = {
  USERS: 'users',
  SEASONS: 'seasons',
  ZONES: 'zones',
  COLLECTIONS: 'collections',
  BOILS: 'boils',
  WEATHER_CACHE: 'weatherCache',
  ORGANIZATIONS: 'organizations',
  ORGANIZATION_MEMBERS: 'organizationMembers',
  ORGANIZATION_INVITES: 'organizationInvites',
};

/**
 * Helper to convert Firestore Timestamp to Date
 */
export const timestampToDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  return timestamp;
};

/**
 * Helper to create Firestore Timestamp from Date
 */
export const dateToTimestamp = (date) => {
  if (!date) return Firestore.Timestamp.now();
  if (date instanceof Date) return Firestore.Timestamp.fromDate(date);
  if (typeof date === 'string') return Firestore.Timestamp.fromDate(new Date(date));
  return Firestore.Timestamp.fromDate(new Date(date));
};

/**
 * Convert Firestore document to plain object with proper date handling
 */
export const docToObject = (doc) => {
  if (!doc || !doc.exists) return null;

  const data = doc.data();
  if (!data) return null;

  const result = { ...data, id: doc.id };

  // Convert Firestore Timestamps to ISO strings
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object' && result[key].toDate) {
      result[key] = result[key].toDate().toISOString();
    }
  }

  return result;
};
