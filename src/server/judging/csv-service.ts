import { and, eq, sql, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  auditLogs,
  events,
  judgeAssignments,
  normalizedScores,
  scores,
  submissions,
  teams,
  tracks,
} from "../../db/schema";

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  const needsQuoting =
    str.includes(",") || str.includes('"') || str.includes("\r") || str.includes("\n");
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvField(c)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(row[c])).join(","));
  }
  return lines.join("\n");
}

const CSV_COLUMNS = [
  "project_id",
  "project_name",
  "team_name",
  "track",
  "judge_count",
  "raw_average",
  "normalized_total",
];

export async function buildJudgingCsv(eventId: string): Promise<string> {
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Error("Event not found");
  }

  const judgeCountSql = sql<number>`COUNT(DISTINCT CASE WHEN ${judgeAssignments.status} = 'COMPLETED' THEN ${scores.id} END)`.as("judge_count");
  const rawAvgSql = sql<number>`AVG(${scores.rawTotal})`.as("raw_average");

  const rows = await db
    .select({
      id: submissions.id,
      title: submissions.title,
      teamName: teams.name,
      trackName: tracks.name,
      normalizedTotal: normalizedScores.normalizedTotal,
      judgeCount: judgeCountSql,
      rawAverage: rawAvgSql,
    })
    .from(submissions)
    .innerJoin(tracks, eq(submissions.trackId, tracks.id))
    .innerJoin(teams, eq(submissions.teamId, teams.id))
    .leftJoin(normalizedScores, and(eq(normalizedScores.submissionId, submissions.id), eq(normalizedScores.eventId, eventId)))
    .leftJoin(judgeAssignments, and(eq(judgeAssignments.submissionId, submissions.id), eq(judgeAssignments.eventId, eventId)))
    .leftJoin(scores, eq(scores.assignmentId, judgeAssignments.id))
    .where(and(eq(tracks.eventId, eventId), eq(submissions.isDraft, false)))
    .groupBy(
      submissions.id,
      submissions.title,
      teams.name,
      tracks.name,
      normalizedScores.normalizedTotal,
    )
    .orderBy(asc(submissions.id));

  const csvRows = rows.map((r) => ({
    project_id: r.id,
    project_name: r.title,
    team_name: r.teamName,
    track: r.trackName,
    judge_count: r.judgeCount ?? 0,
    raw_average: r.rawAverage !== null && r.rawAverage !== undefined ? Number(r.rawAverage).toFixed(2) : "",
    normalized_total: r.normalizedTotal !== null && r.normalizedTotal !== undefined ? Number(r.normalizedTotal).toFixed(4) : "",
  }));

  return buildCsv(csvRows, CSV_COLUMNS);
}

export async function writeAudit(actorId: string, eventId: string): Promise<void> {
  await db.insert(auditLogs).values({
    actorId,
    action: "CSV_EXPORTED",
    entityType: "event",
    entityId: eventId,
    payloadJson: { exportedAt: new Date().toISOString() },
  });
}
