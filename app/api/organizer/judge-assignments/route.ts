import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, parseBody, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import {
  judgeAssignments,
  scores,
  submissions,
  teams,
  tracks,
  users,
} from '@/src/db/schema'
import { assignmentCreateSchema, batchAssignSchema } from '@/src/lib/api/schemas'
import {
  createAssignment,
  assignProjectsToJudges,
} from '@/src/server/judging/assignment-service'

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)
    if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const assignmentRows = await db
      .select({
        assignment: judgeAssignments,
        submission: submissions,
        team: teams,
        track: tracks,
        score: scores,
      })
      .from(judgeAssignments)
      .innerJoin(submissions, eq(judgeAssignments.submissionId, submissions.id))
      .innerJoin(teams, eq(submissions.teamId, teams.id))
      .innerJoin(tracks, eq(submissions.trackId, tracks.id))
      .leftJoin(scores, eq(scores.assignmentId, judgeAssignments.id))
      .where(eq(judgeAssignments.eventId, eventId))

    const assignments = assignmentRows.map((row) => {
      const base: Record<string, unknown> = {
        id: row.assignment.id,
        eventId: row.assignment.eventId,
        judgeId: row.assignment.judgeId,
        submissionId: row.assignment.submissionId,
        status: row.assignment.status,
        submission: {
          id: row.submission.id,
          title: row.submission.title,
          team: { id: row.team.id, name: row.team.name },
          track: { id: row.track.id, name: row.track.name },
        },
      }
      if (row.score) {
        base.score = {
          rawTotal: row.score.rawTotal,
          submittedAt: row.score.submittedAt.toISOString(),
        }
      }
      return base
    })

    const progressRows = await db
      .select({
        judgeId: judgeAssignments.judgeId,
        assigned: sql<number>`count(distinct ${judgeAssignments.id})`.mapWith(Number),
        completed: sql<number>`count(distinct ${scores.assignmentId})`.mapWith(Number),
      })
      .from(judgeAssignments)
      .leftJoin(scores, eq(scores.assignmentId, judgeAssignments.id))
      .where(eq(judgeAssignments.eventId, eventId))
      .groupBy(judgeAssignments.judgeId)

    const judgeIds = progressRows.map((r) => r.judgeId)
    const judgeUsers = judgeIds.length > 0
      ? await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(sql`${users.id} in ${judgeIds}`)
      : []
    const judgeMap = new Map(judgeUsers.map((u) => [u.id, u]))

    const perJudgeProgress = progressRows.map((row) => {
      const u = judgeMap.get(row.judgeId)
      const assigned = row.assigned
      const completed = row.completed
      const pending = Math.max(0, assigned - completed)
      return {
        judgeId: row.judgeId,
        email: u?.email ?? null,
        name: u?.name ?? null,
        assigned,
        completed,
        pending,
        progressPercent: assigned > 0 ? (completed / assigned) * 100 : 0,
      }
    })

    return NextResponse.json({ assignments, perJudgeProgress })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const rawBody = await request.json().catch(() => ({}))
    const mode: string = (rawBody as Record<string, unknown>).mode === 'batch' ? 'batch' : 'single'

    if (mode === 'batch') {
      const body = await parseBody(request, batchAssignSchema)
      const role = await getEffectiveRole(session.user, body.eventId)
      if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
      }
      const result = await assignProjectsToJudges({
        actorId: session.user.id,
        eventId: body.eventId,
        submissionIds: body.submissionIds,
        k: body.k,
      })
      return NextResponse.json({
        created: result.created,
        skippedDuplicate: result.skippedDuplicate,
        skippedIneligible: result.skippedIneligible,
        skipped: result.skippedDuplicate + result.skippedIneligible,
      }, { status: 200 })
    }

    const body = await parseBody(request, assignmentCreateSchema)
    const role = await getEffectiveRole(session.user, body.eventId)
    if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    const created = await createAssignment({
      actorId: session.user.id,
      eventId: body.eventId,
      judgeId: body.judgeId,
      submissionId: body.submissionId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
