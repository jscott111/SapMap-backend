/**
 * One-time migration:
 * 1. Create an org for each user who has seasons with no organizationId; attach those seasons to the org.
 * 2. For each zone that has seasonId, set organizationId from its season (then zones are org-scoped).
 *
 * Run from backend dir: node scripts/migrate-personal-seasons-and-zones.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { initFirestore } from '../src/storage/firestore.js';
import { seasonRepository } from '../src/storage/repositories/SeasonRepository.js';
import { zoneRepository } from '../src/storage/repositories/ZoneRepository.js';
import { operationRepository } from '../src/storage/repositories/OperationRepository.js';
import { operationMemberRepository } from '../src/storage/repositories/OperationMemberRepository.js';
import { userRepository } from '../src/storage/repositories/UserRepository.js';

async function main() {
  await initFirestore();
  console.log('Firestore connected.\n');

  // --- 1. Personal seasons -> org ---
  const allSeasons = await seasonRepository.findAll();
  const personalSeasons = allSeasons.filter((s) => s.userId && (s.organizationId == null || s.organizationId === ''));
  if (personalSeasons.length === 0) {
    console.log('No personal seasons (no organizationId) found. Skipping season migration.');
  } else {
    const byUser = new Map();
    for (const s of personalSeasons) {
      if (!byUser.has(s.userId)) byUser.set(s.userId, []);
      byUser.get(s.userId).push(s);
    }
    console.log(`Found ${personalSeasons.length} personal season(s) for ${byUser.size} user(s).\n`);

    for (const [userId, seasons] of byUser) {
      const user = await userRepository.findById(userId);
      const name = user?.name || 'User';
      const orgName = `${name}'s Sugarbush`;
      const org = await operationRepository.create({
        name: orgName,
        createdBy: userId,
      });
      await operationMemberRepository.addMember(org.id, userId, 'admin', null);
      console.log(`Created org "${orgName}" (${org.id}) for user ${userId}`);

      for (const season of seasons) {
        await seasonRepository.update(season.id, { organizationId: org.id });
        console.log(`  Attached season ${season.id} (${season.year}) to org ${org.id}`);
      }
      console.log('');
    }
  }

  // --- 2. Zones: set organizationId from season ---
  const allZones = await zoneRepository.findAll();
  const zonesWithSeason = allZones.filter((z) => z.seasonId);
  if (zonesWithSeason.length === 0) {
    console.log('No zones with seasonId found. Skipping zone migration.');
  } else {
    console.log(`Found ${zonesWithSeason.length} zone(s) to migrate.\n`);
    for (const zone of zonesWithSeason) {
      const season = await seasonRepository.findById(zone.seasonId);
      if (!season) {
        console.warn(`Zone ${zone.id}: season ${zone.seasonId} not found, skipping.`);
        continue;
      }
      const orgId = season.organizationId;
      if (!orgId) {
        console.warn(`Zone ${zone.id}: season ${zone.seasonId} has no organizationId, skipping.`);
        continue;
      }
      await zoneRepository.update(zone.id, { organizationId: orgId });
      console.log(`Zone ${zone.id} (${zone.name}) -> organizationId ${orgId}`);
    }
  }

  console.log('\nMigration done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
