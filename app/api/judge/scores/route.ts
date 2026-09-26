import { NextResponse } from 'next/server'
import { and, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, parseBody, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import {
  auditLogs,
  judgeAssignments,
  rubrics,
  scores,
  submissions,
  teams,
  tracks,
  users,
} from '@/src/db/schema'
import { calculateRawTotal, validateRubricCriteriaStrict, RubricValidationError } from '@/src/server/judging/rubric-service'

const scoreSubmissionSchema = z.object({
  eventId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  criterionScores: z.record(z.string(), z.number()),
  comment: z.string().max(5000).optional().nullable(),
})

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')
    const judgeParam = searchParams.get('judge')

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }
    if (!judgeParam) {
      return NextResponse.json({ error: 'JUDGE_PARAM_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)

    if (role === 'PARTICIPANT' || role === null) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    if (role === 'JUDGE') {
      if (judgeParam !== session.user.id) {
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
      }
    }

    const rows = await db
      .select({
        score: scores,
        assignment: judgeAssignments,
        submission: submissions,
        team: teams,
        track: tracks,
      })
      .from(scores)
      .innerJoin(judgeAssignments, eq(scores.assignmentId, judgeAssignments.id))
      .innerJoin(submissions, eq(scores.submissionId, submissions.id))
      .innerJoin(teams, eq(submissions.teamId, teams.id))
      .innerJoin(tracks, eq(submissions.trackId, tracks.id))
      .where(
        and(
          eq(judgeAssignments.eventId, eventId),
          eq(scores.judgeId, judgeParam),
        ),
      )

    const result = rows.map((row) => ({
      id: row.score.id,
      assignmentId: row.score.assignmentId,
      judgeId: row.score.judgeId,
      submissionId: row.score.submissionId,
      rubricScoresJson: row.score.rubricScoresJson,
      rawTotal: row.score.rawTotal,
      comment: row.score.comment,
      submittedAt: row.score.submittedAt.toISOString(),
      submission: {
        title: row.submission.title,
        team: { name: row.team.name },
        track: { name: row.track.name },
      },
      assignmentStatus: row.assignment.status,
    }))

    return NextResponse.json({ scores: result })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = await parseBody(request, scoreSubmissionSchema)
    const { eventId, assignmentId, criterionScores, comment } = body

    const role = await getEffectiveRole(session.user, eventId)
    if (role === 'PARTICIPANT' || role === null) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const [assignment] = await db
      .select({
        assignment: judgeAssignments,
        submissionTrackId: submissions.trackId,
      })
      .from(judgeAssignments)
      .innerJoin(submissions, eq(judgeAssignments.submissionId, submissions.id))
      .where(eq(judgeAssignments.id, assignmentId))
      .limit(1)

    if (!assignment) {
      return NextResponse.json({ error: 'ASSIGNMENT_NOT_FOUND' }, { status: 404 })
    }

    if (assignment.assignment.eventId !== eventId) {
      return NextResponse.json({ error: 'ASSIGNMENT_EVENT_MISMATCH' }, { status: 400 })
    }

    if (role === 'JUDGE') {
      if (assignment.assignment.judgeId !== session.user.id) {
        return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
      }
      if (assignment.assignment.status === 'COMPLETED') {
        return NextResponse.json({ error: 'ASSIGNMENT_ALREADY_COMPLETED' }, { status: 409 })
      }
    }

    const [trackRubric] = await db
      .select({ rubric: rubrics })
      .from(rubrics)
      .where(
        and(
          eq(rubrics.eventId, eventId),
          eq(rubrics.trackId, assignment.submissionTrackId),
        ),
      )
      .limit(1)

    let selectedRubric = trackRubric?.rubric

    if (!selectedRubric) {
      const [eventRubric] = await db
        .select({ rubric: rubrics })
        .from(rubrics)
        .where(eq(rubrics.eventId, eventId))
        .limit(1)
      selectedRubric = eventRubric?.rubric
    }

    if (!selectedRubric) {
      return NextResponse.json({ error: 'NO_RUBRIC_CONFIGURED' }, { status: 500 })
    }

    const criteria = selectedRubric.criteriaJson
    validateRubricCriteriaStrict(criteria)

    let rawTotal: number
    try {
      rawTotal = calculateRawTotal(criteria, criterionScores)
    } catch (e) {
      if (e instanceof RubricValidationError) {
        return NextResponse.json({ error: 'INVALID_SCORES', detail: e.message }, { status: 400 })
      }
      throw e
    }

    const [existingScore] = await db
      .select({ id: scores.id })
      .from(scores)
      .where(eq(scores.assignmentId, assignmentId))
      .limit(1)

    let returnedScore: typeof scores.$inferSelect
    let statusCode: number
    let auditAction: string

    if (existingScore) {
      const [updated] = await db
        .update(scores)
        .set({
          rubricScoresJson: criterionScores,
          rawTotal,
          comment: comment ?? null,
          submittedAt: new Date(),
        })
        .where(eq(scores.id, existingScore.id))
        .returning()
      returnedScore = updated
      statusCode = 200
      auditAction = 'SCORE_UPDATED'
    } else {
      const [inserted] = await db
        .insert(scores)
        .values({
          assignmentId,
          judgeId: assignment.assignment.judgeId,
          submissionId: assignment.assignment.submissionId,
          rubricScoresJson: criterionScores,
          rawTotal,
          comment: comment ?? null,
        })
        .returning()
      returnedScore = inserted
      statusCode = 201
      auditAction = 'SCORE_SUBMITTED'
    }

    await db
      .update(judgeAssignments)
      .set({ status: 'COMPLETED' })
      .where(eq(judgeAssignments.id, assignmentId))

    await db.insert(auditLogs).values({
      actorId: session.user.id,
      action: auditAction,
      entityType: 'score',
      entityId: returnedScore.id,
      payloadJson: { assignmentId, eventId },
    })

    return NextResponse.json(
      {
        id: returnedScore.id,
        assignmentId: returnedScore.assignmentId,
        judgeId: returnedScore.judgeId,
        submissionId: returnedScore.submissionId,
        rubricScoresJson: returnedScore.rubricScoresJson,
        rawTotal: returnedScore.rawTotal,
        comment: returnedScore.comment,
        submittedAt: returnedScore.submittedAt.toISOString(),
      },
      { status: statusCode },
    )
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
