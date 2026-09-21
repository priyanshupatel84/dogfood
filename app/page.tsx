import { cookies } from 'next/headers'
import { getSessionUser, isImpersonationEnabled, listUserEventRoles } from '@/src/server/auth-service'
import ImpersonationSwitcher from './components/impersonation-switcher'
import LogoutButton from './components/logout-button'

export default async function HomePage() {
  const token = (await cookies()).get('dogfood_session')?.value ?? ''
  const session = await getSessionUser(token)
  const eventRoles = session ? await listUserEventRoles(session.user.id) : []

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-[#181a20]">
      <div className="mx-auto max-w-180 px-5 py-12">
        <p className="text-[15px] font-bold tracking-[-0.02em]">dogfood</p>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.035em] text-[#20222b]">Hackathon Console</h1>
        <p className="mt-1 text-[13px] text-[#858894]">Offline-first · Dogfood 2026 · T1 core auth</p>

        <div className="mt-6 rounded-xl border border-[#e8e9ee] bg-white p-6">
          {session ? (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#a3a6b0]">Signed in</p>
              <p className="mt-2 text-[16px] font-bold">{session.user.email}</p>
              <p className="mt-1 text-[12px] text-[#777a86]">
                Global role: <span className="font-bold text-[#464956]">{session.user.role}</span>
                {session.user.organization ? ` · ${session.user.organization}` : ''}
              </p>
              <div className="mt-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#a3a6b0]">Event roles</p>
                {eventRoles.length === 0 ? (
                  <p className="mt-1 text-[12px] text-[#777a86]">No event assignments — defaults to PARTICIPANT.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {eventRoles.map((row) => (
                      <li key={row.id} className="text-[12px] text-[#777a86]">
                        <span className="font-mono text-[11px]">{row.eventId.slice(0, 8)}…</span>{' '}
                        <span className="font-bold text-[#464956]">{row.role}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-5 flex items-center gap-2">
                <a
                  href="/console"
                  className="inline-flex h-9 items-center rounded-lg bg-[#635bdb] px-4 text-[12px] font-bold text-white hover:bg-[#574fcc]"
                >
                  Open console
                </a>
                <LogoutButton />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#a3a6b0]">Signed out</p>
              <p className="mt-2 text-[14px] text-[#777a86]">You are not logged in. Use a seeded dev account or register.</p>
              <div className="mt-4 flex items-center gap-2">
                <a
                  href="/login"
                  className="inline-flex h-9 items-center rounded-lg bg-[#635bdb] px-4 text-[12px] font-bold text-white hover:bg-[#574fcc]"
                >
                  Log in
                </a>
                <span className="text-[12px] text-[#999ca7]">or switch identity below (dev only).</span>
              </div>
            </div>
          )}
        </div>

        {isImpersonationEnabled() && (
          <div className="mt-4">
            <ImpersonationSwitcher currentEmail={session?.user.email ?? null} />
          </div>
        )}

        <div className="mt-4 rounded-xl border border-[#e8e9ee] bg-white p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#a3a6b0]">Verify</p>
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[#777a86]">
            <li><a className="font-semibold text-[#635bdb]" href="/api/health">GET /api/health</a> — service health</li>
            <li><a className="font-semibold text-[#635bdb]" href="/api/auth/me">GET /api/auth/me</a> — current session (401 when signed out)</li>
            <li><span className="font-mono text-[11px]">openapi-spec.json</span> — generated API contract</li>
          </ul>
        </div>
      </div>
    </main>
  )
}
