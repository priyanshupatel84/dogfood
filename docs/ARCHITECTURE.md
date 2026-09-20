# Dogfood 2026 Architecture

Offline-first Next.js App Router application with PostgreSQL/Drizzle for durable state and MinIO for local object storage. API boundaries validate input with Zod, sessions are opaque and revocable, and event phases are derived from server timestamps.

The `docker-compose.yml` file provides the complete local runtime: app, Postgres, and MinIO.
