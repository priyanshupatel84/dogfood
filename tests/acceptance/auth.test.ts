import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canAccess, cookieOptions, createSessionToken, hashSessionToken, requireRole } from '../../src/lib/auth'
import {
  impersonateRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  assignEventRoleRequestSchema,
} from '../../src/lib/api/schemas'
import {
  hashPassword,
  isImpersonationEnabled,
  normalizeRole,
  normalizeRoleInput,
  verifyPassword,
} from '../../src/server/auth-service'
import { buildOpenApiSpec } from '../../src/server/openapi'
import { canAssignEventRole, resolveEffectiveRole } from '../../src/db/schema'

const root = join(__dirname, '..', '..')

describe('T1 password hashing (Argon2id)', () => {
  it('hashes and verifies, rejecting wrong passwords', async () => {
    const hash = await hashPassword('DogfoodLocal1!')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(hash, 'DogfoodLocal1!')).toBe(true)
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false)
  })

  it('salts hashes so identical passwords differ', async () => {
    const a = await hashPassword('same-password-1')
    const b = await hashPassword('same-password-1')
    expect(a).not.toBe(b)
  })
})

describe('T1 opaque sessions (no JWT)', () => {
  it('issues unique URL-safe tokens and stores only their hash', () => {
    const a = createSessionToken()
    const b = createSessionToken()
    expect(a).not.toBe(b)
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(a)).not.toContain(a)
    expect(hashSessionToken(a)).toBe(hashSessionToken(a))
  })

  it('sets a locked-down session cookie', () => {
    const options = cookieOptions()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe('/')
    expect(options.maxAge).toBe(60 * 60 * 24 * 7)
  })
})

describe('T1 event-contextual RBAC', () => {
  it('resolves SUPERADMIN globally and everyone else per event', () => {
    expect(resolveEffectiveRole('SUPERADMIN', null)).toBe('SUPERADMIN')
    expect(resolveEffectiveRole('SUPERADMIN', 'JUDGE')).toBe('SUPERADMIN')
    expect(resolveEffectiveRole('PARTICIPANT', 'ORGANIZER')).toBe('ORGANIZER')
    expect(resolveEffectiveRole('PARTICIPANT', 'JUDGE')).toBe('JUDGE')
    expect(resolveEffectiveRole('PARTICIPANT', null)).toBe('PARTICIPANT')
    expect(resolveEffectiveRole('JUDGE', undefined)).toBe('PARTICIPANT')
  })

  it('lets superadmins and organizers grant event roles, nobody else', () => {
    expect(canAssignEventRole('SUPERADMIN', 'JUDGE')).toBe(true)
    expect(canAssignEventRole('ORGANIZER', 'JUDGE')).toBe(true)
    expect(canAssignEventRole('ORGANIZER', 'ORGANIZER')).toBe(true)
    expect(canAssignEventRole('JUDGE', 'PARTICIPANT')).toBe(false)
    expect(canAssignEventRole('PARTICIPANT', 'PARTICIPANT')).toBe(false)
  })

  it('normalizes roles case-insensitively with an admin alias', () => {
    expect(normalizeRole('admin')).toBe('SUPERADMIN')
    expect(normalizeRole('SuperAdmin')).toBe('SUPERADMIN')
    expect(normalizeRole('organizer')).toBe('ORGANIZER')
    expect(normalizeRole('judge')).toBe('JUDGE')
    expect(normalizeRole('nobody')).toBe(null)
    expect(normalizeRoleInput('superadmin', true)).toBe(null)
    expect(normalizeRoleInput('judge', true)).toBe('JUDGE')
  })

  it('enforces legacy role gates', () => {
    expect(canAccess('JUDGE', ['JUDGE', 'ORGANIZER'])).toBe(true)
    expect(canAccess('PARTICIPANT', ['JUDGE'])).toBe(false)
    expect(() => requireRole('PARTICIPANT', ['ORGANIZER'])).toThrow('Forbidden')
    expect(() => requireRole(undefined, ['ORGANIZER'])).toThrow('Forbidden')
  })
})

describe('T1 offline impersonation gate', () => {
  it('is enabled only for non-production offline environments', () => {
    expect(isImpersonationEnabled({ NODE_ENV: 'development', OFFLINE_MODE: 'true' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isImpersonationEnabled({ NODE_ENV: 'production', OFFLINE_MODE: 'true' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isImpersonationEnabled({ NODE_ENV: 'development', OFFLINE_MODE: 'false' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isImpersonationEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('T1 Zod API validation', () => {
  it('accepts valid register/login payloads', () => {
    expect(registerRequestSchema.safeParse({ email: 'a@local', password: 'long-enough-1' }).success).toBe(true)
    expect(loginRequestSchema.safeParse({ email: 'a@local', password: 'x' }).success).toBe(true)
    expect(impersonateRequestSchema.safeParse({ email: 'judge1@local' }).success).toBe(true)
  })

  it('rejects bad emails, short passwords, and malformed role grants', () => {
    expect(registerRequestSchema.safeParse({ email: 'not-an-email', password: 'long-enough-1' }).success).toBe(false)
    expect(registerRequestSchema.safeParse({ email: 'a@local', password: 'short' }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ email: 'a@local', password: '' }).success).toBe(false)
    expect(
      assignEventRoleRequestSchema.safeParse({ userId: 'not-a-uuid', role: 'JUDGE' }).success,
    ).toBe(false)
    expect(
      assignEventRoleRequestSchema.safeParse({ userId: '123e4567-e89b-12d3-a456-426614174000', role: 'SUPERADMIN' }).success,
    ).toBe(false)
  })
})

describe('T1 OpenAPI generated from Zod', () => {
  it('exposes every auth and role path from the single route registry', () => {
    const spec = buildOpenApiSpec()
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/auth/impersonate',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/register',
      '/api/events/{id}/roles',
      '/api/health',
    ])
    const login = (spec.paths['/api/auth/login'] as Record<string, { requestBody: { content: { 'application/json': { schema: object } } } }>).post
    expect(login.requestBody.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['email', 'password'],
    })
  })

  it('keeps the committed spec in sync with the registry', () => {
    const committed = JSON.parse(readFileSync(join(root, 'openapi-spec.json'), 'utf8'))
    expect(Object.keys(committed.paths).sort()).toEqual(Object.keys(buildOpenApiSpec().paths).sort())
  })
})

describe('T1 migration ships event-contextual roles', () => {
  it('creates the event_roles table and event_role enum', () => {
    const sql = readFileSync(join(root, 'drizzle', '0000_t1_core_auth.sql'), 'utf8')
    expect(sql).toContain("CREATE TYPE \"public\".\"event_role\" AS ENUM('ORGANIZER', 'JUDGE', 'PARTICIPANT')")
    expect(sql).toContain('CREATE TABLE "event_roles"')
    expect(sql).toContain('CONSTRAINT "event_role_unique" UNIQUE("event_id","user_id")')
  })
})
