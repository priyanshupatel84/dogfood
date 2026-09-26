import { cookies } from 'next/headers'

import { getSessionUser } from '@/src/server/auth-service'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import HeroSection from '@/components/home/hero-section'
import StatsBanner from '@/components/home/stats-banner'
import ActiveHackathons from '@/components/home/active-hackathons'
import OrganizerFeatures from '@/components/home/organizer-features'

// Marketing homepage. Structure and copy follow homepage.md; all styling
// follows docs/STYLE-GUIDELINES.md (theme tokens, flat surfaces, green accent
// only), which wins wherever the two conflict (no gradients, glow,
// glassmorphism, or hardcoded dark slate).
export default async function HomePage() {
  const token = (await cookies()).get('dogfood_session')?.value ?? ''
  const session = await getSessionUser(token)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar
        user={
          session ? { name: session.user.name, email: session.user.email } : null
        }
      />
      <main>
        <HeroSection />
        <StatsBanner />
        <ActiveHackathons />
        <OrganizerFeatures />
      </main>
      <Footer />
    </div>
  )
}
