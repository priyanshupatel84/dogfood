# Tier 2 — Judging System Specification

## Problem

The Dogfood 2026 hackathon platform currently has database tables and stub helpers for judging but lacks a complete, production-correct implementation: no judge assignment APIs, no secured scoring endpoints, no rubric validation, no Z-score normalization persistence, no CSV export, and no judge/organizer dashboards. T1 functionality (auth, event roles, submissions, gallery) must continue to work unchanged.

## Users

- **Organizer**: Manages judges, assignments, rubrics, runs normalization, exports results CSV.
- **Judge**: Views own assigned submissions, scores them against the rubric, sees progress.
- **Participant**: Submits projects; must NOT access judging data.
- **SUPERADMIN**: Bypasses all event-scoped checks (existing behavior preserved).

## Goals

1. Implement backend-enforced judging with event-scoped RBAC.
2. Provide judge scoring with server-calculated weighted `rawTotal`.
3. Persist per-judge Z-score normalized project scores.
4. Provide organizer CSV export of normalized results.
5. Deliver judge and organizer dashboard UIs backed by the database.
6. Pass T2 acceptance suite: `pnpm test`, `pnpm acceptance`.

## Non-Goals

- Rebuilding authentication, sessions, event roles, submissions, teams, or tracks.
- Introducing external services (Clerk, Auth0, Supabase, Firebase, hosted DBs, cloud auth).
- Adding a second ORM or authentication system.
- JWTs, localStorage roles, or client-side role decisions.
- Microservices, message queues, Redis, Kafka.
- Public participant view of individual judge scores (private by default).

---

## Functional Requirements

### FR-1 Judge Management & Invitation

- Organizers can grant/revoke JUDGE event role via existing `assignEventRole` flow.
- Judge track eligibility is configured via `judgeTracks`.

### FR-2 Rubric Configuration

- Rubrics carry `criteriaJson` with `{id, label, weight}` array.
- Weight total must equal 100 for percentage rubrics; server validates.
- Rubric may be associated with a `trackId` (nullable, event-level if null).
- Server rejects: negative weights, zero criteria, duplicate criterion IDs, missing labels, unknown criteria at score time.

### FR-3 Judge Assignment

- `judgeAssignments` table used with status `PENDING` / `COMPLETED`.
- Unique on `(judgeId, submissionId)` enforced by existing index.
- Pre-create validation: judge exists, submission exists, submission in target event, user has JUDGE/ORGANIZER event role, judge eligible for track when `judgeTracks` configured, no duplicate.
- Batch/algorithmic assignment: deterministic, workload-balanced, respects track eligibility, no duplicates — exposed as `assignProjectsToJudges(...)`.

### FR-4 Judge Scoring

- Endpoints: `GET /api/judge/scores?judge=ID`, `POST /api/judge/scores`.
- Client submits only per-criterion scores (0–100); server computes `rawTotal = Σ(score × weight / 100)`.
- Client-supplied `rawTotal` is never authoritative.
- One score per `assignmentId` (UNIQUE constraint + 409 on duplicate).
- Assignment status moves `PENDING → COMPLETED` on scoring.
- Audit events: `SCORE_SUBMITTED`, `SCORE_UPDATED`.

### FR-5 Backend Role Isolation

- Every event-sensitive endpoint: authenticate session → resolve event → `getEffectiveRole(user, eventId)` → authorize.
- Judge-specific access: `JUDGE` role requires `requestedJudgeId === authenticatedUserId` (else 403).
- Organizer can access organizer-level judging management endpoints.
- Participants receive 403 on judge/organizer judging APIs.

### FR-6 Score Access Isolation

- `judgeA → GET /api/judge/scores?judge=judgeA` → 200.
- `judgeB → GET /api/judge/scores?judge=judgeA` → 403.
- `participant → GET /api/judge/scores?judge=judgeA` → 403 (or 401 if no session).

### FR-7 Judge Progress Dashboard

- Per-judge stats: assigned count, completed count, pending count, progress %.
- Backed by database; no hard-coded values.
- Judge sees only own progress; organizer sees aggregate + per-judge.

### FR-8 Organizer Judging Dashboard

- Total judges, total assignments, completed evaluations, pending evaluations, overall progress.
- Judge-by-judge progress table.
- Rubric configuration UI, normalization action, results view, CSV export button.

### FR-9 Z-Score Normalization

- Per-judge population statistics (not global mean across judges).
- Population standard deviation: `σ = sqrt(Σ(X − μ)² / N)`.
- `Z = (X − μ) / σ`; if `σ === 0` then `Z = 0` (explicit, no NaN/Infinity).
- Group completed (COMPLETED assignment) valid scores by judge → compute μ, σ → compute each Z → average per submission → persist to `normalizedScores`.
- Deterministic; recalculation overwrites previous normalized values from raw source only.
- Endpoint `POST /api/organizer/judging/normalize` (organizer-only).
- Audit event `NORMALIZATION_RUN`.

### FR-10 Normalized Scores Table

- `normalizedScores`: id, eventId, submissionId, normalizedTotal, calculatedAt.
- Unique on `(eventId, submissionId)`.

### FR-11 Organizer CSV Export

- Route: `GET /api/organizer/export` or organizer-scoped CSV route (documented in `.dogfood.toml`).
- Headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="export.csv"`.
- Columns (minimum): `project_id, project_name, track, normalized_total`.
- Preferred extras: `team_name, judge_count, raw_average`.
- Real CSV escaping (commas, quotes, newlines, Unicode, empty values) — no manual string concatenation.
- Authorization: ORGANIZER/SUPERADMIN event role only; participants 403, judges 403.
- Audit event `CSV_EXPORTED`.

### FR-12 Assignment API

- `GET /api/judge/assignments` — judge sees only own assignments.
- `GET/POST /api/organizer/judge-assignments` — organizer create/view/batch, progress.
- Judge cannot retrieve another judge's assignments via any parameter.

### FR-13 Fixture Compatibility

- `scripts/load-fixtures.ts`, `scripts/seed.ts`, `src/db/fixtures.json` continue working.
- Existing fixture scores (with weight=1 criteria and sum-based rawTotal) load without modification.
- New weighted-rubric behavior coexists with legacy fixture rubric shape.

### FR-14 Audit Logging

- Use existing `auditLogs` table.
- Events: `JUDGE_ASSIGNED`, `SCORE_SUBMITTED`, `SCORE_UPDATED`, `NORMALIZATION_RUN`, `CSV_EXPORTED`.
- Record `actorId, action, entityType, entityId, payloadJson, createdAt`.

### FR-15 API Error Codes

- 401 for missing/invalid auth; 403 for insufficient role; 404 for missing entity; 409 for duplicate assignment/score; 400 for malformed input.
- Consistent with existing `authErrorResponse` conventions.

### FR-16 .dogfood.toml & Acceptance Compatibility

- `.dogfood.toml` provides route keys:
  - `judge_scores = "/api/judge/scores?judge=<judge_a_uuid>"`
  - `peer_scores = "/api/judge/scores?judge=<judge_a_uuid>"`  (used by judge_b to probe 403)
  - `csv_export = "/api/organizer/export"`
- `[auth]` section provides Cookie headers compatible with seeded fixture judge accounts.

### FR-17 Frontend UI

- Judge Dashboard: progress + assigned projects (pending/completed states).
- Judge Evaluation Page: project info, rubric inputs, weighted total preview, submit.
- Organizer Judging Management: judges, assignments, progress, rubric config, normalize action, results, CSV export.
- No fake/hard-coded dashboard data.

---

## Non-Functional Requirements

### NFR-1 Backend-Enforced Security

Frontend conditionals, hidden buttons, and route guards are UX only; authorization is in the API/service layer.

### NFR-2 Determinism

Assignment algorithm, normalization, and weighted totals are deterministic (same input → same output).

### NFR-3 Offline / Local

No network-dependent services; works with Docker Compose PostgreSQL; no external APIs.

### NFR-4 Testability

Core services (assignment, scoring calc, normalization, CSV) are pure/isolated functions independently testable without HTTP.

### NFR-5 T1 Preservation

All T1 tests pass; T1 endpoints and auth behavior unchanged.

---

## Constraints & Dependencies

- Stack preserved: Next.js 15 App Router, TypeScript, React, PostgreSQL, Drizzle ORM, Zod, Vitest, Docker Compose.
- Existing schema extended, not replaced: tables/columns/constraints added via new migration `drizzle/0004_t2_judging.sql`.
- Existing helpers reused: `getEffectiveRole`, `getSessionUser`, `resolveEffectiveRole`, `zScore()` in `schema.ts`, normalization helpers in `src/lib/judging/normalization.ts`.
- Existing `judgeAssignments.status` stored as `text` (validated strictly to `PENDING|COMPLETED`) — no destructive enum migration if fixtures break; enum-ification optional if safe.
- Seed users `judge1@local` (global PARTICIPANT + event JUDGE) pattern preserved; must be handled via event role only.

## Assumptions

- Criterion score range: 0 to 100 inclusive (integers or floats, server validates numeric range).
- Percentage-based rubric weights sum to 100.
- Fixture rubric with weight=1 criteria is grandfathered; fixture rawTotal is already sum-based, so fixture loading logic not rewired.
- `.dogfood.toml` auth uses seeded session cookie or impersonation cookie for the acceptance harness to authenticate judge_a / judge_b / participant / organizer against the fixture-loaded event.

## Open Questions

None at spec time; all design choices resolved in constraints above.

---

## Acceptance Criteria (AC)

All ACs are typed `rule` (binary) unless evaluative.

### AC-1 — rule
Existing T1 test suite passes: `pnpm test` produces no failures in existing tests.

### AC-2 — rule
Judge authorization rule: `participant → GET /api/judge/scores → 403`.

### AC-3 — rule
Judge authorization rule: `judgeA → GET /api/judge/scores?judge=judgeA → 200`.

### AC-4 — rule
Judge authorization rule: `judgeB → GET /api/judge/scores?judge=judgeA → 401 or 403`.

### AC-5 — rule
Rubric validation rejects a rubric whose weights do not sum to 100.

### AC-6 — rule
Rubric validation rejects rubrics with duplicate criterion IDs, negative weights, zero-length criteria, or missing labels.

### AC-7 — rule
Score submission: server calculates `rawTotal` from rubric criteria weights; client-supplied `rawTotal` is ignored/not required.

### AC-8 — rule
Score range 0–100 enforced; values outside or non-numeric rejected with 400.

### AC-9 — rule
Unknown criteria in score payload rejected.

### AC-10 — rule
Missing required criteria in score payload rejected.

### AC-11 — rule
Duplicate score for same assignment returns 409; `scores.assignmentId` uniqueness enforced.

### AC-12 — rule
Assignment created for ineligible-track judge rejected.

### AC-13 — rule
Duplicate assignment `(judgeId, submissionId)` rejected (409).

### AC-14 — rule
Assignment for submission belonging to different event rejected.

### AC-15 — rule
Only assigned judge (or organizer) can create a score for an assignment; unassigned judge cannot.

### AC-16 — rule
On successful score submission, assignment status moves from `PENDING` to `COMPLETED`.

### AC-17 — rule
Normalization: per-judge mean, population standard deviation, per-judge Z-score correctly computed.

### AC-18 — rule
Zero standard deviation produces Z=0 (no NaN/Infinity) for that judge's evaluations.

### AC-19 — rule
Normalization result per submission = average of its per-judge Z-scores; persisted to `normalizedScores`; unique `(eventId, submissionId)`.

### AC-20 — rule
Running normalization twice with identical raw inputs yields identical normalized values (deterministic, no accumulation).

### AC-21 — rule
Only completed/valid scores participate; pending/invalid/deleted assignments excluded.

### AC-22 — rule
CSV endpoint returns status 200, `Content-Type: text/csv`, `Content-Disposition: attachment; filename="export.csv"`, and the first line contains a comma.

### AC-23 — rule
CSV unauthorized: participant → 403; judge → 403.

### AC-24 — rule
CSV columns include at minimum: `project_id, project_name, track, normalized_total`; values properly CSV-escaped.

### AC-25 — rule
Judge progress dashboard (API response) returns assigned/completed/pending/progress% derived from database.

### AC-26 — rule
Organizer dashboard returns per-judge progress table from database.

### AC-27 — rule
Audit events `JUDGE_ASSIGNED`, `SCORE_SUBMITTED`, `NORMALIZATION_RUN`, `CSV_EXPORTED` are recorded in `auditLogs` for their respective operations.

### AC-28 — rule
`pnpm acceptance` (calls Vitest + run-acceptance) passes; all T2 checks in `run.py` (judge sees own scores, judge cannot see peer scores, participant blocked, csv export works) pass.

### AC-29 — rule
Migration `drizzle/0004_t2_judging.sql` (or next sequential tag) exists and:
- adds `trackId` nullable FK to `rubrics`,
- adds `normalizedScores` table with unique `(eventId, submissionId)`,
- adds unique constraint on `scores.assignmentId` (or equivalent safe migration),
- runs cleanly on fresh DB and existing fixture DB via `pnpm db:migrate` + `pnpm db:fixtures`.

### AC-30 — rule
Docker workflow `docker compose up --build` starts application successfully after dependencies are local; no network dependency at runtime.

### AC-31 — rubric
Dimension: **Security & RBAC fidelity (0–2)**.
- `0`: at least one authorization endpoint relies on frontend-only checks or global role only.
- `1`: all endpoints use event-scoped `getEffectiveRole`, but one cross-judge probe leaks 200 in a non-acceptance scenario.
- `2`: every judge/organizer/participant probe follows the auth→event→role→ownership pipeline correctly across all endpoints.
**Pass threshold: 2**.

### AC-32 — rubric
Dimension: **Test coverage quality (0–2)**.
- `0`: fewer than half the required T2 test categories exist.
- `1`: all categories present but edge cases (zero σ, duplicate, bad weight sum, CSV escaping) weakly covered.
- `2`: authorization, assignment, score submission, normalization, and CSV tests all cover required rules with passing assertions.
**Pass threshold: 2**.

### AC-33 — rubric
Dimension: **Fixture & legacy compatibility (0–2)**.
- `0`: `pnpm db:migrate` or `pnpm db:fixtures` fails on the existing fixtures.
- `1`: fixtures load but seed users/judges or legacy rubric shape require manual patching beyond the documented flow.
- `2`: `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:fixtures` all succeed without modification to fixture data.
**Pass threshold: 2**.

### AC-34 — rubric
Dimension: **UI data integrity (0–2)**.
- `0`: dashboard numbers are hard-coded placeholders.
- `1`: dashboards hit APIs but show partial or inconsistently filtered data.
- `2`: judge & organizer dashboards show database-derived numbers with correct scope isolation.
**Pass threshold: 2**.
