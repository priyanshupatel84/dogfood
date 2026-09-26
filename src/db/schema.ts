import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  real,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", [
  "SUPERADMIN",
  "ORGANIZER",
  "JUDGE",
  "PARTICIPANT",
]);
export const eventRoleEnum = pgEnum("event_role", [
  "ORGANIZER",
  "JUDGE",
  "PARTICIPANT",
]);
export const eventStatusEnum = pgEnum("event_status", [
  "DRAFT",
  "REGISTRATION",
  "SUBMISSION",
  "JUDGING",
  "PUBLIC_VOTING",
  "ARCHIVED",
]);
export const memberRoleEnum = pgEnum("member_role", ["LEADER", "MEMBER"]);

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  // Display name (e.g. fixture judges carry names; team members may be
  // email-only). Nullable because credentials, not identity, gate access.
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("PARTICIPANT"),
  organization: text("organization"),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ sessionsUserIdx: index("sessions_user_idx").on(t.userId) }),
);

export const events = pgTable("events", {
  id: id(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  status: eventStatusEnum("status").notNull().default("DRAFT"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  // Every phase carries an explicit start and end. The *_end / *_start
  // columns below default (in deriveEventStatus) to the legacy implied
  // boundaries, so rows written before they existed behave identically.
  registrationStart: timestamp("registration_start", { withTimezone: true }),
  registrationEnd: timestamp("registration_end", { withTimezone: true }),
  submissionStart: timestamp("submission_start", { withTimezone: true }),
  submissionDeadline: timestamp("submission_deadline", {
    withTimezone: true,
  }).notNull(),
  judgingStart: timestamp("judging_start", { withTimezone: true }),
  judgingEndTime: timestamp("judging_end_time", {
    withTimezone: true,
  }).notNull(),
  publicVotingStart: timestamp("public_voting_start", { withTimezone: true }),
  publicVotingEndTime: timestamp("public_voting_end_time", {
    withTimezone: true,
  }).notNull(),
  createdAt: createdAt(),
});
export const tracks = pgTable("tracks", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  eligibilityRules: jsonb("eligibility_rules")
    .$type<Record<string, unknown>>()
    .default({}),
});
export const prizes = pgTable("prizes", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id),
  title: text("title").notNull(),
  cashValue: integer("cash_value").notNull(),
});
export const teams = pgTable("teams", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  inviteCodeHash: text("invite_code_hash").notNull(),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: createdAt(),
});
export const teamMembers = pgTable("team_members", {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("MEMBER"),
    // Column name is explicit: the shared createdAt() helper hardcodes
    // "created_at", but this table's migration column is "joined_at".
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ teamMemberUnique: uniqueIndex("team_member_unique").on(t.teamId, t.userId) }),
);
export const submissions = pgTable("submissions", {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id),
    title: text("title").notNull().default("Untitled project"),
    tagline: text("tagline"),
    description: text("description"),
    techStack: jsonb("tech_stack").$type<string[]>().default([]),
    repoUrl: text("repo_url"),
    demoUrl: text("demo_url"),
    assetKeys: jsonb("asset_keys").$type<string[]>().default([]),
    isDraft: boolean("is_draft").notNull().default(true),
    isHidden: boolean("is_hidden").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({ submissionsTeamIdx: index("submissions_team_idx").on(t.teamId) }),
);
export const rubrics = pgTable("rubrics", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  criteriaJson: jsonb("criteria_json")
    .$type<Array<{ id: string; label: string; weight: number }>>()
    .notNull(),
});
// Judge track expertise (fixture judges declare tracks[] they can review).
// Distinct from judge_assignments, which maps a judge to a specific
// submission: this table records which tracks a judge is qualified for.
export const judgeTracks = pgTable(
  "judge_tracks",
  {
    id: id(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    judgeId: uuid("judge_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    judgeTrackUnique: uniqueIndex("judge_track_unique").on(t.judgeId, t.trackId),
  }),
);
export const judgeAssignments = pgTable("judge_assignments", {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    judgeId: uuid("judge_id")
      .notNull()
      .references(() => users.id),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("PENDING"),
  },
  (t) => ({ judgeSubmissionUnique: uniqueIndex("judge_submission_unique").on(t.judgeId, t.submissionId) }),
);
export const scores = pgTable("scores", {
  id: id(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => judgeAssignments.id, { onDelete: "cascade" }),
  judgeId: uuid("judge_id")
    .notNull()
    .references(() => users.id),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  rubricScoresJson: jsonb("rubric_scores_json")
    .$type<Record<string, number>>()
    .notNull(),
  rawTotal: real("raw_total").notNull(),
  // Judge's written remark (blank fixture comments load as NULL).
  comment: text("comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const pairwiseComparisons = pgTable("pairwise_comparisons", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  judgeId: uuid("judge_id")
    .notNull()
    .references(() => users.id),
  winnerSubmissionId: uuid("winner_submission_id")
    .notNull()
    .references(() => submissions.id),
  loserSubmissionId: uuid("loser_submission_id")
    .notNull()
    .references(() => submissions.id),
  createdAt: createdAt(),
});
export const votes = pgTable("votes", {
  id: id(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  voterFingerprint: text("voter_fingerprint").notNull(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  voteWeight: integer("vote_weight").notNull().default(1),
  createdAt: createdAt(),
});
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});
// Event-contextual RBAC: a user's permission is scoped to (event_id, role).
// users.role carries only the global flag (SUPERADMIN bypasses all event checks);
// every other permission resolves through this table, defaulting to PARTICIPANT.
export const eventRoles = pgTable("event_roles", {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: eventRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    eventRoleUnique: uniqueIndex("event_role_unique").on(t.eventId, t.userId),
    eventRoleUserIdx: index("event_role_user_idx").on(t.userId),
  }),
);

export type UserRole = (typeof roleEnum.enumValues)[number];
export type EventRole = (typeof eventRoleEnum.enumValues)[number];
export type DbUser = typeof users.$inferSelect;
export type DbEvent = typeof events.$inferSelect;

// Resolve the effective role for (globalRole, eventRole): SUPERADMIN is the
// only global flag and bypasses event checks; everyone else resolves through
// their event mapping and defaults to PARTICIPANT.
export function resolveEffectiveRole(
  globalRole: UserRole,
  eventRole: EventRole | null | undefined,
): UserRole {
  if (globalRole === "SUPERADMIN") return "SUPERADMIN";
  return eventRole ?? "PARTICIPANT";
}

// Who may grant `target` inside an event: SUPERADMIN can grant anything;
// an ORGANIZER of that event can grant ORGANIZER/JUDGE/PARTICIPANT but can
// never grant SUPERADMIN (global flags are not event-scoped).
export function canAssignEventRole(
  actor: UserRole,
  target: EventRole,
): boolean {
  if (actor === "SUPERADMIN") return true;
  if (actor === "ORGANIZER") return true;
  return false;
}
export type EventStatus = (typeof eventStatusEnum.enumValues)[number];
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;

export const allTables = {
  users,
  sessions,
  events,
  eventRoles,
  tracks,
  prizes,
  teams,
  teamMembers,
  submissions,
  rubrics,
  judgeTracks,
  judgeAssignments,
  scores,
  pairwiseComparisons,
  votes,
  auditLogs,
};
// PostgreSQL production migrations should add pg_trgm, tsvector indexes, roster cardinality checks, and the prize floor trigger.
// Roster limits mirror REQUIREMENTS §4 (Team Engine): $1 \le Team Size \le 4$,
// enforced at the API boundary by validateTeamSize. They are constants by
// default but overridable via TEAM_MIN_SIZE / TEAM_MAX_SIZE (e.g. staging
// experiments); invalid values fall back to the product defaults and max is
// always clamped to be >= min so the range can never invert.
export function resolveConstraints(env: Record<string, string | undefined> = process.env): {
  minTeamSize: number
  maxTeamSize: number
  maxTaglineLength: number
} {
  const minTeamSize = parsePositiveInt(env.TEAM_MIN_SIZE, 1)
  const maxTeamSize = Math.max(parsePositiveInt(env.TEAM_MAX_SIZE, 4), minTeamSize)
  return { minTeamSize, maxTeamSize, maxTaglineLength: 140 }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) && value >= 1 ? value : fallback
}

export const constraints = resolveConstraints();

export function deriveEventStatus(
  event: {
    status: EventStatus;
    registrationStart?: Date | null;
    registrationEnd?: Date | null;
    submissionStart?: Date | null;
    submissionDeadline: Date;
    judgingStart?: Date | null;
    judgingEndTime: Date;
    publicVotingStart?: Date | null;
    publicVotingEndTime: Date;
  },
  now = new Date(),
): EventStatus {
  if (event.status === "DRAFT") return "DRAFT";
  // Explicit per-phase boundaries win; each falls back to the legacy implied
  // boundary so events without the newer columns derive exactly as before.
  const registrationEnd =
    event.registrationEnd ?? event.submissionStart ?? event.submissionDeadline;
  const judgingStart = event.judgingStart ?? event.submissionDeadline;
  const publicVotingStart = event.publicVotingStart ?? event.judgingEndTime;
  if (now < registrationEnd) return "REGISTRATION";
  if (now <= event.submissionDeadline) return "SUBMISSION";
  if (now < judgingStart) return "JUDGING";
  if (now <= publicVotingStart) return "JUDGING";
  if (now <= event.publicVotingEndTime) return "PUBLIC_VOTING";
  return "ARCHIVED";
}

export function canEditSubmission(
  event: Pick<typeof events.$inferSelect, "submissionDeadline">,
  now = new Date(),
) {
  return now <= event.submissionDeadline;
}
export function canChangePrize(
  eventStatus: EventStatus,
  previous: number,
  next: number,
) {
  return eventStatus === "DRAFT" || next >= previous;
}

export function isPublicSubmission(
  eventStatus: EventStatus,
  submission: Pick<Submission, "isDraft" | "isHidden">,
) {
  return (
    !submission.isDraft &&
    !submission.isHidden &&
    ["JUDGING", "PUBLIC_VOTING", "ARCHIVED"].includes(eventStatus)
  );
}

export function validateUrl(value: string) {
  return /^https?:\/\/[^\s]+$/i.test(value);
}
export function validateTagline(value: string) {
  return value.length <= constraints.maxTaglineLength;
}
export function validateTeamSize(size: number) {
  return size >= constraints.minTeamSize && size <= constraints.maxTeamSize;
}

export function quadraticVoteCost(votes: number) {
  return votes * votes;
}
export function zScore(value: number, mean: number, standardDeviation: number) {
  return standardDeviation === 0 ? 0 : (value - mean) / standardDeviation;
}
export function minMax(value: number, min: number, max: number) {
  return max === min ? 50 : ((value - min) / (max - min)) * 100;
}
export function trimmedMean(values: number[]) {
  if (values.length < 5)
    return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const sorted = [...values].sort((a, b) => a - b).slice(1, -1);
  return sorted.reduce((a, b) => a + b, 0) / sorted.length;
}
export function weightedMean(
  scores: Record<string, number>,
  criteria: Array<{ id: string; weight: number }>,
) {
  return criteria.reduce((sum, c) => sum + (scores[c.id] ?? 0) * c.weight, 0);
}
export function bradleyTerryProbability(
  winnerStrength: number,
  loserStrength: number,
) {
  return winnerStrength / (winnerStrength + loserStrength);
}

export function seededOrder<T>(items: T[], seed: string) {
  let hash = 2166136261;
  for (const char of seed)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return [...items]
    .map((item, index) => ({ item, key: Math.imul(hash + index, 2654435761) }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

export function inviteTokenHash(token: string) {
  return token;
}
export function generateInviteToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `DF-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}
