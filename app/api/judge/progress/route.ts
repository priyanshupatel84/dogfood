import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import { judgeAssignments, scores } from '@/src/db/schema'

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')
    let judgeParam = searchParams.get('judge')

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)

    if (role === 'PARTICIPANT' || role === null) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    let targetJudgeId: string
    if (role === 'JUDGE') {
      targetJudgeId = session.user.id
    } else {
      if (!judgeParam) {
        return NextResponse.json({ error: 'JUDGE_PARAM_REQUIRED' }, { status: 400 })
      }
      targetJudgeId = judgeParam
    }

    const [{ count: assignedCount }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(judgeAssignments)
      .where(
        and(
          eq(judgeAssignments.eventId, eventId),
          eq(judgeAssignments.judgeId, targetJudgeId),
        ),
      )

    const [{ count: completedCount }] = await db
      .select({ count: sql<number>`count(distinct ${judgeAssignments.id})`.mapWith(Number) })
      .from(judgeAssignments)
      .innerJoin(scores, eq(scores.assignmentId, judgeAssignments.id))
      .where(
        and(
          eq(judgeAssignments.eventId, eventId),
          eq(judgeAssignments.judgeId, targetJudgeId),
        ),
      )

    const assigned = assignedCount
    const completed = completedCount
    const pending = Math.max(0, assigned - completed)
    const progressPercent = assigned > 0 ? (completed / assigned) * 100 : 0

    return NextResponse.json({
      assigned,
      completed,
      pending,
      progressPercent,
    })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
