# SapMap Backend - production image for Cloud Run
FROM node:20-alpine AS base

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY src ./src

# Cloud Run expects PORT env; default 8080
ENV NODE_ENV=production
EXPOSE 8080

# Use PORT from environment (Cloud Run sets PORT=8080)
CMD ["node", "server.js"]
