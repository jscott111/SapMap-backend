# SapMap Backend

API server for the SapMap maple sap production tracking application.

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Fastify
- **Database**: Google Cloud Firestore
- **Authentication**: JWT

## Getting Started

### Prerequisites

- Node.js 18+
- Google Cloud Project with Firestore enabled, OR Firebase Emulator

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment file and configure:
   ```bash
   cp .env.example .env
   ```

3. Configure `.env`:
   - `JWT_SECRET`: A secure random string for signing tokens
   - `GOOGLE_CLOUD_PROJECT_ID`: Your GCP project ID
   - `FIRESTORE_EMULATOR_HOST`: Set to `localhost:8181` for local development

### Running with Firestore Emulator

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```

2. Start the emulator:
   ```bash
   firebase emulators:start --only firestore
   ```

3. Start the server:
   ```bash
   npm run dev
   ```

### Running with Real Firestore

1. Set `GOOGLE_APPLICATION_CREDENTIALS` to your service account key file path
2. Remove `FIRESTORE_EMULATOR_HOST` from `.env`
3. Start the server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login and get token
- `GET /api/auth/me` - Get current user
- `PATCH /api/auth/preferences` - Update user preferences

### Seasons
- `GET /api/seasons` - List all seasons
- `GET /api/seasons/active` - Get active season
- `POST /api/seasons` - Create season
- `PATCH /api/seasons/:id` - Update season
- `POST /api/seasons/:id/activate` - Set as active
- `DELETE /api/seasons/:id` - Delete season

### Zones
- `GET /api/zones` - List zones
- `POST /api/zones` - Create zone
- `PATCH /api/zones/:id` - Update zone
- `DELETE /api/zones/:id` - Delete zone

### Collections
- `GET /api/collections` - List collections
- `GET /api/collections/daily` - Get daily totals
- `POST /api/collections` - Create collection
- `PATCH /api/collections/:id` - Update collection
- `DELETE /api/collections/:id` - Delete collection

### Boils
- `GET /api/boils` - List boil sessions
- `POST /api/boils` - Create boil session
- `PATCH /api/boils/:id` - Update boil
- `DELETE /api/boils/:id` - Delete boil

### Weather
- `GET /api/weather/forecast` - Get 7-day forecast
- `GET /api/weather/date/:date` - Get weather for specific date
- `GET /api/weather/range` - Get weather for date range

### Stats
- `GET /api/stats/season` - Get season statistics
- `GET /api/stats/zones` - Get zone-level stats
- `GET /api/stats/weather-correlation` - Get weather correlation data

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment | development |
| `JWT_SECRET` | JWT signing secret | (required) |
| `GOOGLE_CLOUD_PROJECT_ID` | GCP project ID | (required) |
| `FIRESTORE_EMULATOR_HOST` | Emulator host | (optional) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account key | (optional) |
