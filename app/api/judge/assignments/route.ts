import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import {
  judgeAssignments,
  scores,
  submissions,
  teams,
  tracks,
} from '@/src/db/schema'

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')
    const statusFilter = searchParams.get('status')

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)

    if (role === 'PARTICIPANT' || role === null) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const conditions: ReturnType<typeof and>[] = [eq(judgeAssignments.eventId, eventId)]

    if (role === 'JUDGE') {
      conditions.push(eq(judgeAssignments.judgeId, session.user.id))
    }

    if (statusFilter === 'PENDING' || statusFilter === 'COMPLETED') {
      conditions.push(eq(judgeAssignments.status, statusFilter))
    }

    const rows = await db
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
      .where(and(...conditions))

    const assignments = rows.map((row) => {
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

    return NextResponse.json({ assignments })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
