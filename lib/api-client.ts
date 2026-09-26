// Frontend API controllers for authentication.
//
// Components must not call fetch() directly: every auth request from the
// browser goes through these functions, so endpoint URLs, methods, payload
// shapes, and error normalization live in exactly one place.

export interface SessionPayload {
  user: {
    id: string
    email: string
    name: string | null
    role: string
    organization: string | null
    createdAt: string
  }
  expiresAt: string
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError('NETWORK_ERROR', 0)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      typeof data?.error === 'string' ? data.error : 'REQUEST_FAILED',
      response.status,
    )
  }
  return data as T
}

function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

export function apiLogin(email: string, password: string): Promise<SessionPayload> {
  return request<SessionPayload>('/api/auth/login', jsonBody({ email, password }))
}

export function apiLogout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function apiFetchSession(): Promise<SessionPayload> {
  return request<SessionPayload>('/api/auth/me')
}

export function apiImpersonate(email: string): Promise<SessionPayload> {
  return request<SessionPayload>('/api/auth/impersonate', jsonBody({ email }))
}
