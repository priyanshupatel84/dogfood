import { cookies } from 'next/headers'

import { getSessionUser } from '@/src/server/auth-service'
import Navbar from '@/components/navbar'
import Footer from '@/components/footer'
import GalleryBrowser from '@/components/gallery-browser'
import { getGalleryProjects } from '@/src/server/gallery-service'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Project Gallery | Dogfood 2026',
  description: 'Browse published projects from completed hackathons.',
}

// Public gallery (spec routes.gallery = /projects): server-rendered so a
// stranger with no JS — and the acceptance checker — sees every published
// title in the response body. Only non-draft, non-hidden submissions from
// ARCHIVED events are listed; search narrows client-side.
export default async function ProjectsPage() {
  const token = (await cookies()).get('dogfood_session')?.value ?? ''
  const session = await getSessionUser(token)
  const projects = await getGalleryProjects()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar user={session ? { name: session.user.name, email: session.user.email } : null} />
      <main className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-foreground">
          Project Gallery
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Published projects from completed hackathons. {projects.length}{' '}
          {projects.length === 1 ? 'project' : 'projects'} on display.
        </p>
        <GalleryBrowser projects={projects} />
      </main>
      <Footer />
    </div>
  )
}
