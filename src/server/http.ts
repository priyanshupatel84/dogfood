import { serialize } from 'cookie'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { AuthError, getSessionUser, type SessionUser } from './auth-service'

export const SESSION_COOKIE = 'dogfood_session'

export function sessionCookieHeader(token: string, secure: boolean): string {
  return serialize(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export function clearSessionCookieHeader(): string {
  return serialize(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}

export async function getRequestToken(): Promise<string> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? ''
}

function isSecureRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return true
  return new URL(request.url).protocol === 'https:'
}

export function jsonError(code: string, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status })
}

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) return jsonError(error.code, error.status)
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', details: error.flatten() }, { status: 400 })
  }
  console.error('auth route failure', error)
  return jsonError('INTERNAL_ERROR', 500)
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => null)
  return schema.parse(body)
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSessionUser(await getRequestToken())
  if (!session) throw new AuthError('UNAUTHORIZED', 401)
  return session
}

export function withSessionCookie(response: NextResponse, token: string, request: Request): NextResponse {
  response.headers.set('Set-Cookie', sessionCookieHeader(token, isSecureRequest(request)))
  return response
}

export function withClearedSession(response: NextResponse): NextResponse {
  response.headers.set('Set-Cookie', clearSessionCookieHeader())
  return response
}

export function publicUser(user: { id: string; email: string; role: string; organization: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organization: user.organization,
    createdAt: user.createdAt.toISOString(),
  }
}
