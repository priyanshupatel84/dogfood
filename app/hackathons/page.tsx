import { cookies } from 'next/headers'

import { getSessionUser } from '@/src/server/auth-service'
import { getHackathonEvents } from '@/src/server/hackathons-service'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import HackathonTabs from '@/components/hackathon-tabs'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Hackathons | Dogfood 2026',
  description: 'Browse live, upcoming, and past hackathons.',
}

export default async function HackathonsPage() {
  const token = (await cookies()).get('dogfood_session')?.value ?? ''
  const session = await getSessionUser(token)
  const events = await getHackathonEvents()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar user={session ? { name: session.user.name, email: session.user.email } : null} />
      <main className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-foreground">Hackathons</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {events.length} {events.length === 1 ? 'event' : 'events'} on this portal.
        </p>
        <HackathonTabs events={events} />
      </main>
      <Footer />
    </div>
  )
}
