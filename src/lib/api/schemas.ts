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

// Judging primitives ----------------------------------------------------------

export const uuid = z.string().uuid()
export const criterionScores = z.record(z.string(), z.number().finite().gte(0).lte(100))

export const scoreSubmissionSchema = z.object({
  assignmentId: uuid,
  eventId: uuid,
  criterionScores,
  comment: z.string().optional(),
})

export const assignmentCreateSchema = z.object({
  eventId: uuid,
  judgeId: uuid,
  submissionId: uuid,
})

export const batchAssignSchema = z.object({
  eventId: uuid,
  submissionIds: z.array(uuid).optional(),
  judgesPerSubmission: z.number().int().positive().default(2),
})

export const rubricCriterionUpsert = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().gte(0),
})

export const rubricUpsertSchema = z.object({
  eventId: uuid,
  trackId: uuid.nullish(),
  title: z.string().min(1),
  criteria: z.array(rubricCriterionUpsert).min(1).refine((arr) => {
    const seen = new Set<string>()
    for (const c of arr) {
      if (seen.has(c.id)) return false
      seen.add(c.id)
    }
    return true
  }, 'Criterion ids must be unique'),
})

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
  name: z.string().nullable(),
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
