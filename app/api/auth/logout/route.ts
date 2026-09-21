import { NextResponse } from 'next/server'
import { revokeSession } from '@/src/server/auth-service'
import { authErrorResponse, getRequestToken, withClearedSession } from '@/src/server/http'

export async function POST() {
  try {
    await revokeSession(await getRequestToken())
    return withClearedSession(NextResponse.json({ ok: true }))
  } catch (error) {
    return authErrorResponse(error)
  }
}
