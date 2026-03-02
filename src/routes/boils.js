/**
 * Boil Routes
 */

import { boilRepository } from '../storage/repositories/BoilRepository.js';
import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';
import { getMembershipsForUser, canAccessSeason, canWriteSeason } from '../lib/operationAccess.js';
import { trigger } from '../realtime/pusherRealtime.js';
import { notifyOperationMembers } from '../services/NotificationService.js';
import { convertVolume } from '../services/StatsService.js';

export const boilRoutes = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request) => {
    request.memberships = await getMembershipsForUser(request.user.id);
  });

  /**
   * Get all boils for a season
   */
  fastify.get('/', async (request, reply) => {
    const seasonId = request.query.seasonId;
    let targetSeasonId = seasonId;

    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) return { boils: [] };
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    const boils = await boilRepository.findBySeasonId(targetSeasonId);
    return { boils };
  });

  /**
   * Get a specific boil (access via season)
   */
  fastify.get('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);
    if (!boil) return reply.code(404).send({ error: 'Boil not found' });
    const season = await seasonRepository.findById(boil.seasonId);
    if (!season || !canAccessSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Boil not found' });
    }
    return { boil };
  });

  /**
   * Create a new boil entry
   */
  fastify.post('/', async (request, reply) => {
    const {
      seasonId,
      date,
      sapVolumeIn,
      syrupVolumeOut,
      startTime,
      endTime,
      duration,
      notes,
    } = request.body;

    let targetSeasonId = seasonId;
    if (!targetSeasonId) {
      const activeSeason = await seasonRepository.findActiveSeason(
        request.user.id,
        request.memberships
      );
      if (!activeSeason) {
        return reply.code(400).send({ error: 'No active season. Create a season first.' });
      }
      targetSeasonId = activeSeason.id;
    } else {
      const season = await seasonRepository.findById(seasonId);
      if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
        return reply.code(404).send({ error: 'Season not found' });
      }
    }

    let calculatedDuration = duration;
    if (startTime && endTime && !duration) {
      const start = new Date(`1970-01-01T${startTime}`);
      const end = new Date(`1970-01-01T${endTime}`);
      calculatedDuration = (end - start) / 1000 / 60;
    }

    const boil = await boilRepository.create({
      seasonId: targetSeasonId,
      userId: request.user.id,
      date: date || new Date().toISOString().split('T')[0],
      sapVolumeIn: sapVolumeIn || 0,
      syrupVolumeOut: syrupVolumeOut || 0,
      startTime,
      endTime,
      duration: calculatedDuration,
      notes,
    });
    const season = await seasonRepository.findById(targetSeasonId);
    if (season?.organizationId) {
      trigger(season.organizationId, { type: 'boil:created', boil });
      const creatorName = request.user?.name || 'Someone';
      notifyOperationMembers({
        operationId: season.organizationId,
        type: 'boil_created',
        title: 'Boil started',
        body: `${creatorName} has started boiling!`,
        data: { tag: 'sapmap-boil', boilId: boil.id, seasonId: targetSeasonId, path: '/boils' },
        excludeUserId: request.user.id,
      }).catch((err) => console.error('[notifications]', err?.message));
    }
    return { boil };
  });

  /**
   * Adjust today's boil sap volume by a delta (liters).
   * Used for +/- buttons so offline queues can replay without overwriting other users' changes.
   */
  fastify.post('/:id/adjust-sap', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);
    if (!boil) return reply.code(404).send({ error: 'Boil not found' });
    const season = await seasonRepository.findById(boil.seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Boil not found' });
    }
    const deltaLiters = Number(request.body?.deltaLiters);
    if (typeof deltaLiters !== 'number' || Number.isNaN(deltaLiters)) {
      return reply.code(400).send({ error: 'deltaLiters (number) is required' });
    }
    const current = boil.sapVolumeIn ?? 0;
    const newSap = Math.max(0, current + deltaLiters);
    const updated = await boilRepository.update(request.params.id, { sapVolumeIn: newSap });
    if (season.organizationId) {
      trigger(season.organizationId, { type: 'boil:updated', boil: updated });
      const creatorName = request.user?.name || 'Someone';
      const unit = request.user?.preferences?.units || 'liters';
      const absLiters = Math.abs(deltaLiters);
      const displayVol = unit === 'gallons' ? convertVolume(absLiters, 'liters', 'gallons') : absLiters;
      const volStr = `${typeof displayVol === 'number' && !Number.isNaN(displayVol) ? displayVol.toFixed(1) : displayVol} ${unit === 'gallons' ? 'gal' : 'L'}`;
      const body =
        deltaLiters >= 0
          ? `${creatorName} added another ${volStr} to the boil.`
          : `${creatorName} removed ${volStr} from the boil.`;
      notifyOperationMembers({
        operationId: season.organizationId,
        type: 'boil_sap_adjusted',
        title: 'Boil updated',
        body,
        data: { tag: 'sapmap-boil', boilId: updated.id, seasonId: season.id, path: '/boils' },
        excludeUserId: request.user.id,
      }).catch((err) => console.error('[notifications]', err?.message));
    }
    return { boil: updated };
  });

  /**
   * Update a boil
   */
  fastify.patch('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);
    if (!boil) return reply.code(404).send({ error: 'Boil not found' });
    const season = await seasonRepository.findById(boil.seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Boil not found' });
    }
    const updated = await boilRepository.update(request.params.id, request.body);
    if (season.organizationId) {
      trigger(season.organizationId, { type: 'boil:updated', boil: updated });
    }
    return { boil: updated };
  });

  /**
   * Delete a boil
   */
  fastify.delete('/:id', async (request, reply) => {
    const boil = await boilRepository.findById(request.params.id);
    if (!boil) return reply.code(404).send({ error: 'Boil not found' });
    const season = await seasonRepository.findById(boil.seasonId);
    if (!season || !canWriteSeason(request.user.id, season, request.memberships)) {
      return reply.code(404).send({ error: 'Boil not found' });
    }
    await boilRepository.delete(request.params.id);
    if (season.organizationId) {
      trigger(season.organizationId, { type: 'boil:deleted', id: request.params.id });
    }
    return { success: true };
  });
};
