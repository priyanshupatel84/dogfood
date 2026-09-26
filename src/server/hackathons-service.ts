import { db } from '../db'
import { events } from '../db/schema'
import { deriveEventStatus } from '../db/schema'
import { formatSubmittedDate } from '../lib/gallery'
import { classifyEventTab, type HackathonEvent } from '../lib/hackathons'

// All events for the /hackathons listing, oldest first. Status is the
// effective phase-derived status so a stale stored flag never
// miscategorizes an event.
export async function getHackathonEvents(now = new Date()): Promise<HackathonEvent[]> {
  const rows = await db.select().from(events)

  return rows
    .map((row) => {
      const status = deriveEventStatus(row, now)
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        status,
        tab: classifyEventTab(status),
        dateLabel: `${formatSubmittedDate(row.startTime.toISOString())} – ${formatSubmittedDate(row.submissionDeadline.toISOString())}`,
        startTime: row.startTime.toISOString(),
      }
    })
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))
}
