import { NextResponse } from 'next/server'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, parseBody, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import { rubrics, tracks } from '@/src/db/schema'
import { validateRubricCriteriaStrict, RubricValidationError } from '@/src/server/judging/rubric-service'

const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().int().min(0).max(100),
  minScore: z.number().int().optional(),
  maxScore: z.number().int().optional(),
})

const rubricUpsertSchema = z.object({
  eventId: z.string().uuid(),
  trackId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200),
  criteria: z.array(rubricCriterionSchema),
})

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')
    const trackId = searchParams.get('trackId')

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)
    if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const conditions: ReturnType<typeof and>[] = [eq(rubrics.eventId, eventId)]

    if (trackId) {
      conditions.push(
        or(
          isNull(rubrics.trackId),
          eq(rubrics.trackId, trackId),
        ),
      )
    }

    const rows = await db.select().from(rubrics).where(and(...conditions))

    return NextResponse.json({ rubrics: rows })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = await parseBody(request, rubricUpsertSchema)
    const { eventId, trackId, title, criteria } = body

    const role = await getEffectiveRole(session.user, eventId)
    if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    try {
      validateRubricCriteriaStrict(criteria)
    } catch (e) {
      if (e instanceof RubricValidationError) {
        return NextResponse.json({ error: 'INVALID_RUBRIC', detail: e.message }, { status: 400 })
      }
      throw e
    }

    if (trackId) {
      const [track] = await db
        .select({ id: tracks.id, eventId: tracks.eventId })
        .from(tracks)
        .where(eq(tracks.id, trackId))
        .limit(1)
      if (!track || track.eventId !== eventId) {
        return NextResponse.json({ error: 'TRACK_NOT_IN_EVENT' }, { status: 400 })
      }
    }

    const [existing] = await db
      .select({ id: rubrics.id })
      .from(rubrics)
      .where(
        trackId
          ? and(eq(rubrics.eventId, eventId), eq(rubrics.trackId, trackId))
          : and(eq(rubrics.eventId, eventId), isNull(rubrics.trackId)),
      )
      .limit(1)

    let result: typeof rubrics.$inferSelect

    if (existing) {
      const [updated] = await db
        .update(rubrics)
        .set({
          title,
          criteriaJson: criteria,
        })
        .where(eq(rubrics.id, existing.id))
        .returning()
      result = updated
    } else {
      const insertValues: Record<string, unknown> = {
        eventId,
        title,
        criteriaJson: criteria,
        trackId: trackId ?? null,
      }
      const [inserted] = await db.insert(rubrics).values(insertValues).returning()
      result = inserted
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
