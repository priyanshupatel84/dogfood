import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, requireSession, routeContext } from '@/src/server/http'
import { db } from '@/src/db'
import { judgeAssignments, scores, users, eventRoles } from '@/src/db/schema'

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

    const [{ count: totalAssignments }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, eventId))

    const [{ count: completedEvaluations }] = await db
      .select({ count: sql<number>`count(distinct ${scores.id})`.mapWith(Number) })
      .from(scores)
      .innerJoin(judgeAssignments, eq(scores.assignmentId, judgeAssignments.id))
      .where(eq(judgeAssignments.eventId, eventId))

    const judgeFromAssignments = db
      .select({ id: judgeAssignments.judgeId })
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, eventId))

    const judgeFromEventRoles = db
      .select({ id: eventRoles.userId })
      .from(eventRoles)
      .where(sql`${eventRoles.eventId} = ${eventId} and ${eventRoles.role} = 'JUDGE'`)

    const judgeFromGlobal = db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.role} = 'JUDGE'`)

    const allJudgeIds: string[] = []
    const r1 = await judgeFromAssignments
    const r2 = await judgeFromEventRoles
    const r3 = await judgeFromGlobal
    const seen = new Set<string>()
    for (const r of [...r1, ...r2, ...r3]) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        allJudgeIds.push(r.id)
      }
    }
    const totalJudges = allJudgeIds.length

    const pendingEvaluations = Math.max(0, totalAssignments - completedEvaluations)
    const overallProgress = totalAssignments > 0 ? (completedEvaluations / totalAssignments) * 100 : 0

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

    const progressJudgeIds = progressRows.map((r) => r.judgeId)
    const uniqueJudgeIds = new Set([...allJudgeIds, ...progressJudgeIds])
    const judgeList = uniqueJudgeIds.size > 0
      ? await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(sql`${users.id} in ${Array.from(uniqueJudgeIds)}`)
      : []
    const judgeMap = new Map(judgeList.map((u) => [u.id, u]))

    const progressById = new Map(progressRows.map((r) => [r.judgeId, r]))
    const perJudgeProgress = Array.from(uniqueJudgeIds).map((judgeId) => {
      const u = judgeMap.get(judgeId)
      const p = progressById.get(judgeId)
      const assigned = p?.assigned ?? 0
      const completed = p?.completed ?? 0
      const pending = Math.max(0, assigned - completed)
      return {
        judgeId,
        name: u?.name ?? null,
        email: u?.email ?? null,
        assigned,
        completed,
        pending,
        progressPercent: assigned > 0 ? (completed / assigned) * 100 : 0,
      }
    })

    return NextResponse.json({
      totalJudges,
      totalAssignments,
      completedEvaluations,
      pendingEvaluations,
      overallProgress,
      perJudgeProgress,
    })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
