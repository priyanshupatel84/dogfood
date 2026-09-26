import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  auditLogs,
  events,
  judgeAssignments,
  normalizedScores,
  scores,
} from "../../db/schema";

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export function calculatePopulationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(mean)) || !Number.isFinite(Number(stdDev))) {
    return 0;
  }
  if (stdDev === 0) return 0;
  const z = (value - mean) / stdDev;
  return Number.isFinite(z) ? z : 0;
}

interface RawScoreRow {
  judgeId: string;
  submissionId: string;
  rawTotal: number;
}

export interface NormalizationResult {
  submissionsUpdated: number;
  scoreCount: number;
  calculatedAt: Date;
}

export async function runNormalization(eventId: string, actorId: string): Promise<NormalizationResult> {
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw new Error("Event not found");
  }

  const rawScores: RawScoreRow[] = await db
    .select({
      judgeId: scores.judgeId,
      submissionId: scores.submissionId,
      rawTotal: scores.rawTotal,
    })
    .from(scores)
    .innerJoin(judgeAssignments, eq(scores.assignmentId, judgeAssignments.id))
    .where(and(eq(judgeAssignments.eventId, eventId), eq(judgeAssignments.status, "COMPLETED")));

  const scoreCount = rawScores.length;

  const scoresByJudge = new Map<string, number[]>();
  for (const row of rawScores) {
    if (!scoresByJudge.has(row.judgeId)) {
      scoresByJudge.set(row.judgeId, []);
    }
    scoresByJudge.get(row.judgeId)!.push(row.rawTotal);
  }

  const judgeStats = new Map<string, { mean: number; stdDev: number }>();
  for (const [judgeId, vals] of scoresByJudge) {
    const mean = calculateMean(vals);
    const stdDev = calculatePopulationStdDev(vals);
    judgeStats.set(judgeId, { mean, stdDev });
  }

  const zScoresBySubmission = new Map<string, number[]>();
  for (const row of rawScores) {
    const stats = judgeStats.get(row.judgeId);
    if (!stats) continue;
    const z = calculateZScore(row.rawTotal, stats.mean, stats.stdDev);
    if (!zScoresBySubmission.has(row.submissionId)) {
      zScoresBySubmission.set(row.submissionId, []);
    }
    zScoresBySubmission.get(row.submissionId)!.push(z);
  }

  const calculatedAt = new Date();
  let submissionsUpdated = 0;

  for (const [submissionId, zs] of zScoresBySubmission) {
    const normalizedTotal = calculateMean(zs);
    const existing = await db
      .select({ id: normalizedScores.id })
      .from(normalizedScores)
      .where(and(eq(normalizedScores.eventId, eventId), eq(normalizedScores.submissionId, submissionId)))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(normalizedScores)
        .set({ normalizedTotal, calculatedAt })
        .where(eq(normalizedScores.id, existing[0].id));
    } else {
      await db.insert(normalizedScores).values({
        eventId,
        submissionId,
        normalizedTotal,
        calculatedAt,
      });
    }
    submissionsUpdated++;
  }

  await db.insert(auditLogs).values({
    actorId,
    action: "NORMALIZATION_RUN",
    entityType: "event",
    entityId: eventId,
    payloadJson: {
      submissionsCount: submissionsUpdated,
      scoreCount,
      calculatedAt: calculatedAt.toISOString(),
    },
  });

  return { submissionsUpdated, scoreCount, calculatedAt };
}
