/**
 * One-time migration: convert all stored volumes to liters.
 *
 * Collections: where volumeUnit === 'gallons', multiply volume by 3.78541 and remove volumeUnit.
 *              where volumeUnit === 'liters', just remove volumeUnit.
 * Boils: assume existing records were entered in gallons; multiply sapVolumeIn and syrupVolumeOut by 3.78541.
 *
 * Run from project root: node scripts/migrate-volumes-to-liters.js
 * Requires Firestore to be initialized (same env as backend: GOOGLE_APPLICATION_CREDENTIALS or emulator).
 */

import { initFirestore, getDb, Collections } from '../src/storage/firestore.js';
import { FieldValue } from '@google-cloud/firestore';

const GALLONS_TO_LITERS = 3.78541;

async function migrateCollections() {
  const db = getDb();
  const snapshot = await db.collection(Collections.COLLECTIONS).get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const volumeUnit = data.volumeUnit;
    const volume = data.volume ?? 0;

    if (volumeUnit === 'gallons') {
      const volumeLiters = volume * GALLONS_TO_LITERS;
      await doc.ref.update({
        volume: Math.round(volumeLiters * 100) / 100,
        volumeUnit: FieldValue.delete(),
      });
      updated += 1;
    } else if (volumeUnit === 'liters') {
      await doc.ref.update({ volumeUnit: FieldValue.delete() });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { updated, skipped, total: snapshot.size };
}

async function migrateBoils() {
  const db = getDb();
  const snapshot = await db.collection(Collections.BOILS).get();
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const sapIn = data.sapVolumeIn ?? 0;
    const syrupOut = data.syrupVolumeOut ?? 0;

    if (sapIn > 0 || syrupOut > 0) {
      await doc.ref.update({
        sapVolumeIn: Math.round(sapIn * GALLONS_TO_LITERS * 100) / 100,
        syrupVolumeOut: Math.round(syrupOut * GALLONS_TO_LITERS * 1000) / 1000,
      });
      updated += 1;
    }
  }

  return { updated, total: snapshot.size };
}

async function main() {
  console.log('Initializing Firestore...');
  await initFirestore();

  console.log('Migrating collections to liters...');
  const collResult = await migrateCollections();
  console.log(
    `  Collections: ${collResult.updated} updated, ${collResult.skipped} skipped (no unit), ${collResult.total} total`
  );

  console.log('Migrating boils to liters (assuming previous values were gallons)...');
  const boilResult = await migrateBoils();
  console.log(`  Boils: ${boilResult.updated} updated, ${boilResult.total} total`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
