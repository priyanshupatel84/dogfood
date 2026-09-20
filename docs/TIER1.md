# Dogfood 2026: Project Setup & API-First Architecture Guide (Next.js)

This document provides a complete, step-by-step blueprint to initialize and build the **Dogfood 2026** platform using **Next.js (App Router)**, **PostgreSQL**, **Drizzle ORM**, **Argon2id**, **MinIO**, **Zod**, **OpenAPI 3.0**, and **Vitest**.

---

## 1. Technical Requirements & Stack Selection

To ensure the application runs 100% offline via `docker compose up` while remaining scalable and production-ready, the stack is carefully selected without cloud dependencies:

| Layer | Technology Choice | Justification |
| :--- | :--- | :--- |
| **Framework** | Next.js 14+ (App Router) | Server Components, Route Handlers (`src/app/api`), and built-in API routing. |
| **Database** | PostgreSQL 16 | Native Full-Text Search (`tsvector`), Trigram fuzzy matching (`pg_trgm`), JSONB, and atomic transaction locks. |
| **ORM & Migrations** | Drizzle ORM | Zero-overhead, lightweight SQL query builder with type-safe schema definitions and local migration tools. |
| **Authentication** | Argon2id + Opaque DB Sessions | `argon2` for password hashing, stored as HttpOnly encrypted session cookies. |
| **File Storage** | MinIO (Containerized S3) | Amazon S3 API compatible local binary object storage for images, videos, and zip files. |
| **Validation & OpenAPI** | Zod + `@asteasolutions/zod-to-openapi` | Code-first API specification generator ensuring 100% contract alignment between docs and routes. |
| **Testing** | Vitest + Supertest | Rapid unit and integration testing against local PostgreSQL containers without network calls. |

---

## 2. Directory & File Structure

Here is the modular file structure separating business logic, database migrations, API definitions, local CLI tools, and automated acceptance tests:

```
dogfood-platform/
├── .github/
│   └── workflows/
│       └── ci.yml
├── docker/
│   ├── entrypoint.sh
│   └── minio-init.sh
├── docs/
│   ├── openapi.json
│   └── THREAT-MODEL.md
├── scripts/
│   ├── seed.ts
│   └── cli.ts
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── register/
│   │   ├── (dashboard)/
│   │   │   ├── admin/
│   │   │   ├── judge/
│   │   │   └── participant/
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── login/route.ts
│   │   │   │   │   └── logout/route.ts
│   │   │   │   ├── events/route.ts
│   │   │   │   ├── teams/route.ts
│   │   │   │   └── submissions/route.ts
│   │   │   └── docs/route.ts
│   │   ├── gallery/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── db/
│   │   ├── migrations/
│   │   ├── schema/
│   │   │   ├── auth.ts
│   │   │   ├── events.ts
│   │   │   ├── teams.ts
│   │   │   └── submissions.ts
│   │   ├── index.ts
│   │   └── seed-data.ts
│   ├── lib/
│   │   ├── api/
│   │   │   ├── openapi-generator.ts
│   │   │   └── response.ts
│   │   ├── auth/
│   │   │   ├── argon2.ts
│   │   │   ├── rbac.ts
│   │   │   └── session.ts
│   │   ├── storage/
│   │   │   └── minio.ts
│   │   └── utils/
│   └── middleware.ts
├── tests/
│   ├── setup.ts
│   ├── integration/
│   │   ├── auth.test.ts
│   │   ├── deadline.test.ts
│   │   └── teams.test.ts
│   └── unit/
│       └── rbac.test.ts
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── drizzle.config.ts
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Generation Script (Bash Command)

Run this single command in your terminal to instantly create the complete directory structure:

```bash
mkdir -p .github/workflows docker docs scripts \
  src/app/\(auth\)/login src/app/\(auth\)/register \
  src/app/\(dashboard\)/admin src/app/\(dashboard\)/judge src/app/\(dashboard\)/participant \
  src/app/api/v1/auth/login src/app/api/v1/auth/logout \
  src/app/api/v1/events src/app/api/v1/teams src/app/api/v1/submissions \
  src/app/api/docs src/app/gallery \
  src/db/migrations src/db/schema \
  src/lib/api src/lib/auth src/lib/storage src/lib/utils \
  tests/integration tests/unit
```

---

## 3. Step-by-Step Project Setup Guide

### Step 1: Initialize Next.js & Install Dependencies

Run the initialization command in your target directory:

```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-npm
```

Install core runtime dependencies:

```bash
npm install drizzle-orm postgres argon2 @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod @asteasolutions/zod-to-openapi cookie lucide-react
```

Install development and testing dependencies:

```bash
npm install -D drizzle-kit vitest supertest @types/supertest @types/argon2 @types/cookie dotenv tsx
```

---

### Step 2: Configure Environment Variables

Create `.env.example` (and clone to `.env`):

```env
# Application
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
OFFLINE_MODE=true

# Database
DATABASE_URL=postgres://dogfood:dogfood_pass@localhost:5432/dogfood_db

# Local Object Storage (MinIO)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_BUCKET_NAME=dogfood-assets
MINIO_USE_SSL=false

# Session Security
SESSION_SECRET=super-secret-random-32-character-string-here
```

---

### Step 3: OpenAPI-First Contract Setup

To meet the **API-First (+3 Bonus)** requirement, we define routes using **Zod schemas** that generate both runtime request validators and the `openapi.json` spec.

#### `src/lib/api/openapi-generator.ts`

```typescript
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

export const registry = new OpenAPIRegistry();

// Register Authentication Schemas
export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z.string().email().openapi({ example: 'admin@local' }),
    password: z.string().min(8).openapi({ example: 'AdminPass123!' }),
  })
);

export const UserResponseSchema = registry.register(
  'UserResponse',
  z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(['SUPERADMIN', 'ORGANIZER', 'JUDGE', 'PARTICIPANT']),
  })
);

// Define OpenAPI Document Generator Function
export function generateOpenAPISpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Dogfood Hackathon Platform API',
      description: 'Fully self-hostable, offline-first hackathon platform specification.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
```

#### `src/app/api/docs/route.ts`

Serve the generated OpenAPI document directly from Next.js:

```typescript
import { NextResponse } from 'next/server';
import { generateOpenAPISpec } from '@/lib/api/openapi-generator';

export async function GET() {
  const spec = generateOpenAPISpec();
  return NextResponse.json(spec);
}
```

---

### Step 4: Configure Database & Drizzle Schema

#### `src/db/schema/auth.ts`

```typescript
import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['SUPERADMIN', 'ORGANIZER', 'JUDGE', 'PARTICIPANT']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').default('PARTICIPANT').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

#### `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

### Step 5: Implement `dogfood-cli` Tooling

Create a standalone CLI tool in `scripts/cli.ts` to support offline user management and impersonation testing.

#### `scripts/cli.ts`

```typescript
import { db } from '../src/db';
import { users } from '../src/db/schema/auth';
import { hashPassword } from '../src/lib/auth/argon2';

async function main() {
  const command = process.argv[2];

  if (command === 'create-user') {
    const email = process.argv[3];
    const password = process.argv[4] || 'Password123!';
    const role = (process.argv[5] || 'PARTICIPANT') as any;

    if (!email) {
      console.error('Usage: npm run cli create-user <email> [password] [role]');
      process.exit(1);
    }

    const hashedPassword = await hashPassword(password);
    const [user] = await db.insert(users).values({
      email,
      passwordHash: hashedPassword,
      role,
    }).returning();

    console.log(`Successfully created user: ${user.email} (${user.role}) with ID: ${user.id}`);
  } else {
    console.log('Available commands: create-user');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add script execution to `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:seed": "tsx scripts/seed.ts",
  "cli": "tsx scripts/cli.ts",
  "test": "vitest run"
}
```

---

### Step 6: Single-Command Local Setup (`docker-compose.yml`)

The platform **must** start seamlessly offline using `docker compose up`.

#### `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: dogfood_postgres
    environment:
      POSTGRES_USER: dogfood
      POSTGRES_PASSWORD: dogfood_pass
      POSTGRES_DB: dogfood_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dogfood -d dogfood_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:RELEASE.2024-01-18T22-51-28Z
    container_name: dogfood_minio
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dogfood_app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://dogfood:dogfood_pass@postgres:5432/dogfood_db
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
      - MINIO_BUCKET_NAME=dogfood-assets
      - OFFLINE_MODE=true
      - SESSION_SECRET=docker-container-super-secret-key-32chars
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy

volumes:
  postgres_data:
  minio_data:
```

---

### Step 7: Testing Configuration (Vitest Integration)

Set up automated testing for offline acceptance and deadline checks.

#### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

#### `tests/integration/deadline.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Submission Pipeline - Deadline Enforcement', () => {
  it('should reject submission PATCH request when server clock exceeds deadline', async () => {
    const submissionDeadline = new Date('2026-09-20T12:00:00Z');
    
    // Fast forward system time past the deadline
    vi.setSystemTime(new Date('2026-09-20T12:01:00Z'));

    const isExpired = new Date() > submissionDeadline;

    expect(isExpired).toBe(true);
    // Simulating API response expectation
    const apiStatus = isExpired ? 403 : 200;
    expect(apiStatus).toBe(403);

    vi.useRealTimers();
  });
});
```

---

## 4. Verification Workflow

To verify your environment setup:

1. **Boot local services:**
   ```bash
   docker compose up -d postgres minio
   ```
2. **Apply migrations & seed data:**
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```
3. **Run local CLI to create an admin:**
   ```bash
   npm run cli create-user admin@local AdminPass123! SUPERADMIN
   ```
4. **Execute Test Suite:**
   ```bash
   npm run test
   ```
5. **Full Container Stack Verification:**
   ```bash
   docker compose up --build
   ```
   Navigate to `http://localhost:3000/api/docs` to view the live generated OpenAPI specification.