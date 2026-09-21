import { z } from 'zod'

// Shared primitives -----------------------------------------------------------

// Offline-first: accepts dotless local domains (admin@local) that strict
// RFC email validators reject, since there is no DNS or email delivery here.
export const emailSchema = z
  .string()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+$/, 'Invalid email address')
export const passwordSchema = z.string().min(8).max(256)
export const uuidSchema = z.string().uuid()
export const roleSchema = z.enum(['SUPERADMIN', 'ORGANIZER', 'JUDGE', 'PARTICIPANT'])
export const eventRoleSchema = z.enum(['ORGANIZER', 'JUDGE', 'PARTICIPANT'])

// Requests --------------------------------------------------------------------

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  organization: z.string().max(200).optional(),
})

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
})

export const impersonateRequestSchema = z.object({
  email: emailSchema,
})

export const assignEventRoleRequestSchema = z.object({
  userId: uuidSchema,
  role: eventRoleSchema,
})

// Responses -------------------------------------------------------------------

export const userResponseSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  role: roleSchema,
  organization: z.string().nullable(),
  createdAt: z.string(),
})

export const sessionResponseSchema = z.object({
  user: userResponseSchema,
  expiresAt: z.string(),
})

export const eventRoleResponseSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  userId: uuidSchema,
  role: eventRoleSchema,
  createdAt: z.string(),
})

export const eventRoleListResponseSchema = z.object({
  eventId: uuidSchema,
  roles: z.array(eventRoleResponseSchema),
})

export const errorResponseSchema = z.object({
  error: z.string(),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type ImpersonateRequest = z.infer<typeof impersonateRequestSchema>
export type AssignEventRoleRequest = z.infer<typeof assignEventRoleRequestSchema>
