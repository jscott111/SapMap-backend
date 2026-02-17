/**
 * Season Routes
 */

import { seasonRepository } from '../storage/repositories/SeasonRepository.js';
import { authenticate } from '../middleware/auth.js';

export const seasonRoutes = async (fastify) => {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * Get all seasons for the current user
   */
  fastify.get('/', async (request) => {
    const seasons = await seasonRepository.findByUserId(request.user.id);
    return { seasons };
  });

  /**
   * Get the active season
   */
  fastify.get('/active', async (request) => {
    const season = await seasonRepository.findActiveSeason(request.user.id);
    return { season };
  });

  /**
   * Get a specific season
   */
  fastify.get('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);

    if (!season || season.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    return { season };
  });

  /**
   * Create a new season
   */
  fastify.post('/', async (request) => {
    const { name, year, startDate, endDate, location } = request.body;

    const season = await seasonRepository.create({
      userId: request.user.id,
      name: name || `${year || new Date().getFullYear()} Season`,
      year: year || new Date().getFullYear(),
      startDate,
      endDate,
      location,
      isActive: true,
    });

    // Set this as active (deactivates others)
    await seasonRepository.setActive(season.id, request.user.id);

    return { season };
  });

  /**
   * Update a season
   */
  fastify.patch('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);

    if (!season || season.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    const updated = await seasonRepository.update(request.params.id, request.body);
    return { season: updated };
  });

  /**
   * Set a season as active
   */
  fastify.post('/:id/activate', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);

    if (!season || season.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    const updated = await seasonRepository.setActive(request.params.id, request.user.id);
    return { season: updated };
  });

  /**
   * Delete a season
   */
  fastify.delete('/:id', async (request, reply) => {
    const season = await seasonRepository.findById(request.params.id);

    if (!season || season.userId !== request.user.id) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    await seasonRepository.delete(request.params.id);
    return { success: true };
  });
};
