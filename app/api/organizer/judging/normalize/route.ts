import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, parseBody, requireSession, routeContext } from '@/src/server/http'
import { runNormalization } from '@/src/server/judging/normalization'

const normalizeBodySchema = z.object({
  eventId: z.string().uuid().optional(),
})

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const { searchParams } = new URL(request.url)
    const queryEventId = searchParams.get('eventId')

    let eventId: string | null = queryEventId
    if (!eventId) {
      try {
        const body = await parseBody(request, normalizeBodySchema)
        eventId = body.eventId ?? null
      } catch {
        const raw = await request.json().catch(() => ({}))
        eventId = (raw as Record<string, unknown>).eventId as string | null ?? null
      }
    }

    if (!eventId) {
      return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 400 })
    }

    const role = await getEffectiveRole(session.user, eventId)
    if (role !== 'ORGANIZER' && role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const result = await runNormalization(eventId, session.user.id)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
