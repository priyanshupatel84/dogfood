import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiImpersonate, apiLogin, apiLogout } from '../../lib/api-client'

const session = {
  user: { id: '123e4567-e89b-12d3-a456-426614174000', email: 'a@local', role: 'PARTICIPANT', organization: null, createdAt: '2026-01-01T00:00:00.000Z' },
  expiresAt: '2026-01-08T00:00:00.000Z',
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => handler(url, init),
  })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('frontend auth controllers', () => {
  it('posts credentials to the login endpoint and returns the session', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    stubFetch((url, init) => {
      seen.push({ url, init })
      return session
    })
    await expect(apiLogin('a@local', 'secret-123')).resolves.toEqual(session)
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('/api/auth/login')
    expect(seen[0].init?.method).toBe('POST')
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ email: 'a@local', password: 'secret-123' })
  })

  it('routes logout and impersonation through their endpoints', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      return url === '/api/auth/logout' ? { ok: true } : session
    })
    await expect(apiLogout()).resolves.toEqual({ ok: true })
    await expect(apiImpersonate('judge1@local')).resolves.toEqual(session)
    expect(urls).toEqual(['/api/auth/logout', '/api/auth/impersonate'])
  })

  it('normalizes server error codes and network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'INVALID_CREDENTIALS' }) })),
    )
    await expect(apiLogin('a@local', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const error = await apiLogin('a@local', 'secret-123').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('NETWORK_ERROR')
  })
})
