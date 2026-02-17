/**
 * JWT Authentication Middleware
 */

import jwt from 'jsonwebtoken';
import { userRepository } from '../storage/repositories/UserRepository.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Generate a JWT token for a user
 */
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * Verify a JWT token
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Authentication middleware for Fastify
 */
export const authenticate = async (request, reply) => {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Fetch user from database
    const user = await userRepository.findById(decoded.id);

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    // Attach user to request
    request.user = user;
  } catch (error) {
    return reply.code(401).send({ error: 'Authentication failed' });
  }
};

/**
 * Fastify plugin to add authentication hook
 */
export const authPlugin = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
};
