import { NextResponse } from 'next/server'
import { getEffectiveRole } from '@/src/server/auth-service'
import { authErrorResponse, requireSession, routeContext } from '@/src/server/http'
import { buildJudgingCsv, writeAudit } from '@/src/server/judging/csv-service'

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

    const csvString = await buildJudgingCsv(eventId)
    await writeAudit(session.user.id, eventId)

    return new NextResponse(csvString, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="export.csv"',
      },
    })
  } catch (error) {
    return authErrorResponse(error, routeContext(request))
  }
}
