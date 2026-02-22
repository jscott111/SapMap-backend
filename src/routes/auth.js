/**
 * Authentication Routes
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { userRepository } from '../storage/repositories/UserRepository.js';
import { passwordResetTokenRepository } from '../storage/repositories/PasswordResetTokenRepository.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../lib/email.js';

const SALT_ROUNDS = 10;
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

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

  /**
   * Forgot password: send reset link to email if account exists.
   * Always returns 200 with generic message to avoid user enumeration.
   */
  fastify.post('/forgot-password', async (request, reply) => {
    const { email } = request.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await userRepository.findByEmail(normalizedEmail);

    if (user) {
      const token = crypto.randomBytes(24).toString('hex');
      await passwordResetTokenRepository.createToken(user.id, token);
      const resetLink = `${APP_URL}/reset-password?token=${token}`;
      const result = await sendPasswordResetEmail(user.email, resetLink);
      if (!result.sent && process.env.NODE_ENV !== 'production') {
        console.log('[dev] Password reset link (email not sent):', resetLink);
      }
    }

    return {
      message: "If an account exists with that email, we've sent a reset link. Check your inbox.",
    };
  });

  /**
   * Reset password: validate token and set new password.
   */
  fastify.post('/reset-password', async (request, reply) => {
    const { token, password } = request.body;

    if (!token || !password) {
      return reply.code(400).send({ error: 'Token and password are required' });
    }

    if (password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }

    const record = await passwordResetTokenRepository.findByToken(token);
    if (!record || passwordResetTokenRepository.isExpired(record)) {
      return reply.code(400).send({ error: 'Invalid or expired reset link' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await userRepository.updatePassword(record.userId, passwordHash);
    await passwordResetTokenRepository.delete(record.id);

    return { message: 'Password has been reset. You can now log in.' };
  });
};
