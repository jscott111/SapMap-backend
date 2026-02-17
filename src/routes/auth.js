/**
 * Authentication Routes
 */

import bcrypt from 'bcrypt';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const SALT_ROUNDS = 10;

export const authRoutes = async (fastify) => {
  /**
   * Register a new user
   */
  fastify.post('/register', async (request, reply) => {
    const { email, password, name } = request.body;

    if (!email || !password || !name) {
      return reply.code(400).send({ error: 'Email, password, and name are required' });
    }

    if (password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = await userRepository.create({
      email,
      passwordHash,
      name,
    });

    // Generate token
    const token = generateToken(user);

    // Don't return password hash
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  });

  /**
   * Login
   */
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    // Find user
    const user = await userRepository.findByEmail(email);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user);

    // Don't return password hash
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
    };
  });

  /**
   * Get current user
   */
  fastify.get('/me', { preHandler: authenticate }, async (request) => {
    const { passwordHash: _, ...userWithoutPassword } = request.user;
    return { user: userWithoutPassword };
  });

  /**
   * Update user preferences
   */
  fastify.patch('/preferences', { preHandler: authenticate }, async (request) => {
    const { preferences } = request.body;
    const updatedUser = await userRepository.updatePreferences(request.user.id, preferences);
    const { passwordHash: _, ...userWithoutPassword } = updatedUser;
    return { user: userWithoutPassword };
  });
};
