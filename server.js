/**
 * SapMap Backend Server
 * Fastify-based API for maple sap production tracking
 */

import dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initFirestore } from './src/storage/firestore.js';

// Import routes
import { authRoutes } from './src/routes/auth.js';
import { seasonRoutes } from './src/routes/seasons.js';
import { zoneRoutes } from './src/routes/zones.js';
import { collectionRoutes } from './src/routes/collections.js';
import { boilRoutes } from './src/routes/boils.js';
import { weatherRoutes } from './src/routes/weather.js';
import { statsRoutes } from './src/routes/stats.js';
import { organizationRoutes } from './src/routes/organizations.js';
import { inviteRoutes } from './src/routes/invites.js';

const isProduction = process.env.NODE_ENV === 'production';

const fastify = Fastify({
  logger: isProduction
    ? { level: 'warn' }
    : true,
  bodyLimit: 1048576, // 1MB
});

// CORS configuration
await fastify.register(cors, {
  origin: isProduction
    ? (origin, cb) => {
        const allowed = process.env.ALLOWED_ORIGINS?.trim();
        const allowedOrigins = allowed ? allowed.split(',').map((o) => o.trim()) : [];
        if (allowedOrigins.length === 0) {
          cb(null, true);
        } else if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(new Error('Not allowed by CORS'), false);
        }
      }
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

// Security headers
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  if (isProduction) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return payload;
});

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  fastify.log.error(error);

  if (isProduction) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : error.message,
    });
  }

  return reply.code(error.statusCode || 500).send({
    error: error.message,
    stack: error.stack,
  });
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Initialize Firestore and register routes
const start = async () => {
  try {
    await initFirestore();
    console.log('✅ Firestore initialized');

    // Register routes
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(seasonRoutes, { prefix: '/api/seasons' });
    await fastify.register(zoneRoutes, { prefix: '/api/zones' });
    await fastify.register(collectionRoutes, { prefix: '/api/collections' });
    await fastify.register(boilRoutes, { prefix: '/api/boils' });
    await fastify.register(weatherRoutes, { prefix: '/api/weather' });
    await fastify.register(statsRoutes, { prefix: '/api/stats' });
    await fastify.register(organizationRoutes, { prefix: '/api/organizations' });
    await fastify.register(inviteRoutes, { prefix: '/api/invites' });

    const port = process.env.PORT || 3001;
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`🍁 SapMap API running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
