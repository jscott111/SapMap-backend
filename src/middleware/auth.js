/**
 * JWT Authentication Middleware
 */

import jwt from 'jsonwebtoken';
import { userRepository } from '../storage/repositories/UserRepository.js';

const DEV_SECRET = 'dev-secret-change-in-production';
const isProduction = process.env.NODE_ENV === 'production';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || DEV_SECRET;
  if (isProduction && (!secret || secret === DEV_SECRET)) {
    throw new Error(
      'JWT_SECRET must be set to a non-default value in production. Set the JWT_SECRET environment variable.'
    );
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

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
    { expiresIn: '30d' }
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
      request.log?.warn?.({ auth: 'missing' }, '401: Authentication required (no or invalid Authorization header)');
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      request.log?.warn?.({ auth: 'invalid_or_expired' }, '401: Invalid or expired token');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Fetch user from database
    const user = await userRepository.findById(decoded.id);

    if (!user) {
      request.log?.warn?.({ auth: 'user_not_found', userId: decoded.id }, '401: User not found');
      return reply.code(401).send({ error: 'User not found' });
    }

    // Attach user to request
    request.user = user;
  } catch (error) {
    request.log?.warn?.({ err: error, auth: 'failed' }, '401: Authentication failed');
    return reply.code(401).send({ error: 'Authentication failed' });
  }
};

/**
 * Require admin email (allowed admins). Use after authenticate.
 * Returns 403 if request.user.email is not in the allowed list.
 */
const ADMIN_EMAILS = ['johnascott14@gmail.com', 'johnascott14+test@gmail.com'];

export const requireAdmin = async (request, reply) => {
  const email = request.user?.email;
  if (!email || !ADMIN_EMAILS.includes(String(email).toLowerCase())) {
    request.log?.warn?.({ auth: 'admin_forbidden', email: email ? '***' : 'none' }, '403: Admin access denied');
    return reply.code(403).send({ error: 'Forbidden' });
  }
};

/**
 * Fastify plugin to add authentication hook
 */
export const authPlugin = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
};
