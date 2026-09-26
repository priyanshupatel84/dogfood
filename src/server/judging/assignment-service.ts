import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  auditLogs,
  events,
  eventRoles,
  judgeAssignments,
  judgeTracks,
  submissions,
  tracks,
  users,
} from "../../db/schema";
import { getEffectiveRole } from "../auth-service";

export class AssignmentError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "AssignmentError";
  }
}

export async function findEventSubmission(eventId: string, submissionId: string) {
  const rows = await db
    .select({ submission: submissions, event: events })
    .from(submissions)
    .innerJoin(tracks, eq(submissions.trackId, tracks.id))
    .innerJoin(events, eq(tracks.eventId, events.id))
    .where(and(eq(submissions.id, submissionId), eq(events.id, eventId)))
    .limit(1);
  if (rows.length === 0) {
    throw new AssignmentError("Submission not found in event", "SUBMISSION_NOT_FOUND", 404);
  }
  return rows[0];
}

export async function isJudgeEligibleForTrack(judgeId: string, trackId: string): Promise<boolean> {
  const anyTrackRows = await db.select().from(judgeTracks).where(eq(judgeTracks.trackId, trackId)).limit(1);
  if (anyTrackRows.length === 0) {
    return true;
  }
  const match = await db
    .select()
    .from(judgeTracks)
    .where(and(eq(judgeTracks.judgeId, judgeId), eq(judgeTracks.trackId, trackId)))
    .limit(1);
  return match.length > 0;
}

async function hasJudgeOrOrganizerRole(judgeId: string, eventId: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, judgeId)).limit(1);
  if (!user) return false;
  const role = await getEffectiveRole(user, eventId);
  return role === "JUDGE" || role === "ORGANIZER" || role === "SUPERADMIN";
}

export interface AssignmentCreationInput {
  eventId: string;
  judgeId: string;
  submissionId: string;
}

export async function validateAssignmentCreation(input: AssignmentCreationInput): Promise<{ submission: typeof submissions.$inferSelect; event: typeof events.$inferSelect }> {
  const { eventId, judgeId, submissionId } = input;

  const [judge] = await db.select({ id: users.id }).from(users).where(eq(users.id, judgeId)).limit(1);
  if (!judge) {
    throw new AssignmentError("Judge not found", "JUDGE_NOT_FOUND", 404);
  }

  const hasRole = await hasJudgeOrOrganizerRole(judgeId, eventId);
  if (!hasRole) {
    throw new AssignmentError("Judge does not have JUDGE or ORGANIZER role for this event", "JUDGE_NOT_ELIGIBLE", 403);
  }

  const { submission, event } = await findEventSubmission(eventId, submissionId);

  if (submission.trackId) {
    const eligible = await isJudgeEligibleForTrack(judgeId, submission.trackId);
    if (!eligible) {
      throw new AssignmentError("Judge is not eligible for this submission's track", "JUDGE_INELIGIBLE", 403);
    }
  }

  const existing = await db
    .select()
    .from(judgeAssignments)
    .where(
      and(
        eq(judgeAssignments.judgeId, judgeId),
        eq(judgeAssignments.submissionId, submissionId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new AssignmentError("Duplicate judge assignment", "DUPLICATE_ASSIGNMENT", 409);
  }

  return { submission, event };
}

export async function createAssignment(input: {
  actorId: string;
  eventId: string;
  judgeId: string;
  submissionId: string;
}) {
  await validateAssignmentCreation({
    eventId: input.eventId,
    judgeId: input.judgeId,
    submissionId: input.submissionId,
  });

  const [created] = await db
    .insert(judgeAssignments)
    .values({
      eventId: input.eventId,
      judgeId: input.judgeId,
      submissionId: input.submissionId,
      status: "PENDING",
    })
    .returning();

  await db.insert(auditLogs).values({
    actorId: input.actorId,
    action: "JUDGE_ASSIGNED",
    entityType: "judgeAssignment",
    entityId: created.id,
    payloadJson: {
      eventId: input.eventId,
      judgeId: input.judgeId,
      submissionId: input.submissionId,
    },
  });

  return created;
}

export interface BatchAssignInput {
  actorId: string;
  eventId: string;
  submissionIds?: string[];
  k?: number;
}

export interface BatchAssignResult {
  created: number;
  skippedDuplicate: number;
  skippedIneligible: number;
}

export async function assignProjectsToJudges(input: BatchAssignInput): Promise<BatchAssignResult> {
  const { actorId, eventId, k = 2 } = input;

  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new AssignmentError("Event not found", "EVENT_NOT_FOUND", 404);
  }

  let submissionList: Array<{ id: string; trackId: string }>;
  if (input.submissionIds && input.submissionIds.length > 0) {
    const sortedIds = [...new Set(input.submissionIds)].sort((a, b) => a.localeCompare(b));
    submissionList = await db
      .select({ id: submissions.id, trackId: submissions.trackId })
      .from(submissions)
      .innerJoin(tracks, eq(submissions.trackId, tracks.id))
      .where(
        and(
          eq(tracks.eventId, eventId),
          submissions.id.in(sortedIds),
        ),
      )
      .orderBy(submissions.id);
  } else {
    submissionList = await db
      .select({ id: submissions.id, trackId: submissions.trackId })
      .from(submissions)
      .innerJoin(tracks, eq(submissions.trackId, tracks.id))
      .where(and(eq(tracks.eventId, eventId), eq(submissions.isDraft, false)))
      .orderBy(submissions.id);
  }

  const allJudgeRoles = await db
    .select({ userId: eventRoles.userId, role: eventRoles.role })
    .from(eventRoles)
    .where(and(eq(eventRoles.eventId, eventId), eventRoles.role.in(["JUDGE", "ORGANIZER"] as const)));

  const superadminIds = (await db.select({ id: users.id }).from(users).where(eq(users.role, "SUPERADMIN"))).map((u) => u.id);
  const roleJudgeIds = allJudgeRoles.map((r) => r.userId);
  const eligibleJudgeIds = [...new Set([...superadminIds, ...roleJudgeIds])].sort((a, b) => a.localeCompare(b));

  const existingAssignments = await db
    .select({ judgeId: judgeAssignments.judgeId, submissionId: judgeAssignments.submissionId })
    .from(judgeAssignments)
    .where(eq(judgeAssignments.eventId, eventId));
  const assignedPairs = new Set<string>();
  const workload = new Map<string, number>();
  for (const a of existingAssignments) {
    assignedPairs.add(`${a.judgeId}|${a.submissionId}`);
    workload.set(a.judgeId, (workload.get(a.judgeId) ?? 0) + 1);
  }
  for (const jid of eligibleJudgeIds) {
    if (!workload.has(jid)) workload.set(jid, 0);
  }

  const result: BatchAssignResult = { created: 0, skippedDuplicate: 0, skippedIneligible: 0 };
  const sortedSubmissions = [...submissionList].sort((a, b) => a.id.localeCompare(b.id));

  for (const submission of sortedSubmissions) {
    const candidates: string[] = [];
    for (const judgeId of eligibleJudgeIds) {
      const pairKey = `${judgeId}|${submission.id}`;
      if (assignedPairs.has(pairKey)) continue;
      const eligible = await isJudgeEligibleForTrack(judgeId, submission.trackId);
      if (!eligible) continue;
      candidates.push(judgeId);
    }

    const sortedCandidates = [...candidates].sort((a, b) => {
      const loadA = workload.get(a) ?? 0;
      const loadB = workload.get(b) ?? 0;
      if (loadA !== loadB) return loadA - loadB;
      return a.localeCompare(b);
    });

    const picks = sortedCandidates.slice(0, Math.min(k, sortedCandidates.length));

    for (const judgeId of picks) {
      const pairKey = `${judgeId}|${submission.id}`;
      if (assignedPairs.has(pairKey)) {
        result.skippedDuplicate++;
        continue;
      }
      try {
        await createAssignment({ actorId, eventId, judgeId, submissionId: submission.id });
        assignedPairs.add(pairKey);
        workload.set(judgeId, (workload.get(judgeId) ?? 0) + 1);
        result.created++;
      } catch (e) {
        if (e instanceof AssignmentError) {
          if (e.code === "DUPLICATE_ASSIGNMENT") {
            result.skippedDuplicate++;
          } else {
            result.skippedIneligible++;
          }
        } else {
          result.skippedIneligible++;
        }
      }
    }
  }

  return result;
}
