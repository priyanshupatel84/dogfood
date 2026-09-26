import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { events, submissions, teams, tracks } from '../db/schema'
import {
  formatSubmittedDate,
  isGalleryVisible,
  sortGalleryProjects,
  type GalleryProject,
} from '../lib/gallery'

// Public gallery feed: published submissions from completed (ARCHIVED)
// events. Draft/hidden filtering happens in SQL; the archived check applies
// the effective phase-derived status in JS so a stale stored flag can never
// leak an in-progress event's projects.
export async function getGalleryProjects(now = new Date()): Promise<GalleryProject[]> {
  const rows = await db
    .select({ submission: submissions, team: teams, track: tracks, event: events })
    .from(submissions)
    .innerJoin(teams, eq(submissions.teamId, teams.id))
    .innerJoin(tracks, eq(submissions.trackId, tracks.id))
    .innerJoin(events, eq(teams.eventId, events.id))
    .where(and(eq(submissions.isDraft, false), eq(submissions.isHidden, false)))

  return rows
    .filter((row) =>
      isGalleryVisible(
        { isDraft: row.submission.isDraft, isHidden: row.submission.isHidden, event: row.event },
        now,
      ),
    )
    .map((row) => ({
      id: row.submission.id,
      title: row.submission.title,
      tagline: row.submission.tagline,
      repoUrl: row.submission.repoUrl,
      submittedAt: row.submission.submittedAt?.toISOString() ?? null,
      submittedLabel: row.submission.submittedAt
        ? formatSubmittedDate(row.submission.submittedAt.toISOString())
        : null,
      teamName: row.team.name,
      trackName: row.track.name,
      eventTitle: row.event.title,
      eventStatus: row.event.status,
    }))
    .sort(sortGalleryProjects)
}
