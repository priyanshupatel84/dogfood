# Tier 2 — Judging Implementation Tasks

Every task maps to one or more Acceptance Criteria in `spec.md`. TR = Task-local Test Requirement (typed `rule` or `rubric`).

---

## Task 1: Schema & Drizzle migration (track-aware rubrics, normalizedScores, uniqueness)

**Priority:** high
**Depends on:** (none)
**ACs:** AC-29, AC-11, AC-19
**Scope:**
- Edit `src/db/schema.ts`:
  - Add `trackId` (uuid nullable FK → tracks.id) to `rubrics`.
  - Add new `normalizedScores` table: `id`, `eventId` (FK events), `submissionId` (FK submissions), `normalizedTotal` (real NOT NULL), `calculatedAt` (timestamp default now). Unique index on `(eventId, submissionId)`.
  - On `scores` add a unique index on `assignmentId` (use existing pattern, keep data-safe approach — if fixture data has duplicates, resolve in migration by deduping to latest-by-submittedAt first or apply the constraint conditionally after data cleanup).
  - On `judgeAssignments.status`, keep `text` storage but add a Zod-level validator and runtime check; optionally a CHECK constraint in the migration if safe for existing fixtures.
- Run `pnpm db:generate` or write `drizzle/0004_t2_judging.sql` by hand to produce the migration that matches schema.
- Export types for `normalizedScores.$inferSelect` / `$inferInsert` alongside existing types.

**TR-1.1 — rule:** Migration `0004_t2_judging.sql` (or the next sequential tag) contains ALTERs for rubrics.trackId, CREATE normalized_scores, unique scores.assignmentId, and runs cleanly.
**TR-1.2 — rule:** `pnpm db:migrate && pnpm db:fixtures` against a fresh DB succeeds with fixture-compatible schema.

**Status:** pending

---

## Task 2: Rubric validation + weighted score calculation service

**Priority:** high
**Depends on:** Task 1
**ACs:** AC-5, AC-6, AC-7, AC-8, AC-9, AC-10
**Scope:**
- Create `src/server/judging/rubric-service.ts`.
- Zod schema for rubric criteria ensuring:
  - array length >= 1,
  - each item has `{id: string (non-empty, unique), label: string (non-empty), weight: number >= 0}`,
  - sum of weights === 100 (percentage rubric). Allow a legacy-validated flag path that skips sum=100 for fixture rubrics (weight=1, sum=3) — the legacy path used exclusively by `load-fixtures` via explicit opt-in.
- Server-side `calculateRawTotal(rubric, criterionScores)` that:
  - Validates every required criterion ID is present.
  - Rejects unknown criterion IDs.
  - Validates each score 0 <= s <= 100 (number, not NaN, not Infinity).
  - Computes `Σ(score_i * weight_i / 100)` — returns the raw total.
- Reuse the existing `weightedMean` helper from `schema.ts` where it fits; align semantics.

**TR-2.1 — rule:** Rubric with weights summing to 99 or 101 fails validation; sum=100 passes.
**TR-2.2 — rule:** Rubric with duplicate criterion IDs, negative weight, empty criteria, or empty label fails.
**TR-2.3 — rule:** `calculateRawTotal` on {technical:80, innovation:70, ux:75, impact:90} with the spec-example weighted rubric returns exactly 80.75.
**TR-2.4 — rule:** Missing criterion → throws/returns error; unknown criterion → error; score <0 or >100 → error; NaN/string → error.
**TR-2.5 — rule:** Legacy fixture rubric (weights all 1, sum != 100) passes validation only via the fixture-only legacy entry point so `load-fixtures` still works.

**Status:** pending

---

## Task 3: Judge assignment service + batch algorithm

**Priority:** high
**Depends on:** Task 1
**ACs:** AC-12, AC-13, AC-14, AC-27
**Scope:**
- Create `src/server/judging/assignment-service.ts`.
- `validateAssignmentCreation(eventId, judgeId, submissionId)` checks:
  1. judge user exists & has JUDGE/ORGANIZER event role.
  2. submission exists & belongs to eventId.
  3. if submission's track has `judgeTracks` configured for any judge, the judgeId must be in the eligible set (i.e., if judgeTracks has ANY rows for this trackId, judge must have one).
  4. no existing `judgeAssignments` row with same (judgeId, submissionId).
- `createAssignment(actor, eventId, judgeId, submissionId)` performs validation, inserts, writes `JUDGE_ASSIGNED` audit log, returns row.
- `assignProjectsToJudges(eventId, submissionIds?, k=2?)`:
  1. Eligible judges = JUDGE or ORGANIZER event role, filtered per submission track via judgeTracks when configured.
  2. Exclude already-assigned pairs.
  3. For each submission, pick k judges by lowest current workload, tie-break deterministic by userId.localeCompare.
  4. Return created assignments; dedupe-safe (no duplicate pair).
- Reuse existing `loadBalancedKCover` helper in `src/lib/judging/normalization.ts` where it fits (track-awareness is added around it).

**TR-3.1 — rule:** Ineligible-track judge (judgeTracks rows exist but judge not among them) → assignment rejected.
**TR-3.2 — rule:** Creating a duplicate (judgeId, submissionId) assignment → throws 409-equivalent error; existing unique index on judge_submission_unique also prevents it.
**TR-3.3 — rule:** Submission from another event → rejected.
**TR-3.4 — rule:** `assignProjectsToJudges` with fixed seed produces deterministic, balanced assignments; no pair appears twice; workload differs by at most 1 across judges when divisible.
**TR-3.5 — rule:** `JUDGE_ASSIGNED` audit log row written per successful create.

**Status:** pending

---

## Task 4: Z-Score normalization service

**Priority:** high
**Depends on:** Task 1, Task 2
**ACs:** AC-17, AC-18, AC-19, AC-20, AC-21
**Scope:**
- Create `src/server/judging/normalization.ts` (server-side, DB-aware — separate from the pure helpers in `src/lib/judging`).
- Pure helpers (put alongside or reuse from schema.ts / lib/judging):
  - `calculateMean(values: number[]): number`
  - `calculatePopulationStdDev(values: number[]): number` (σ = sqrt(Σ(X−μ)²/N))
  - `calculateZScore(value, mean, stdDev): number` → stdDev===0 returns 0.
- Service function `runNormalization(eventId, actorId)`:
  1. Load COMPLETED assignments + joined `scores.rawTotal` for the event (one score per assignment via assignmentId unique).
  2. Group by judgeId → compute per-judge μ, σ (population) using only that judge's valid scores.
  3. Per score: compute Z = (rawTotal − μ_judge) / σ_judge; σ=0 → Z=0.
  4. Group Z scores by submissionId → average → `normalizedTotal`.
  5. Upsert into `normalizedScores` by `(eventId, submissionId)` — always recalculate from raw; no accumulation from prior normalized rows.
  6. Write `NORMALIZATION_RUN` audit log.

**TR-4.1 — rule:** Given the spec example (Judge A: 60,70,80 → μ=70, σ=√(200/3)≈8.165; Judge B: 80,85,90 → μ=85, σ same). For projects judged by both, the Z-averaged normalizedTotal matches hand calculation.
**TR-4.2 — rule:** Judge with all equal scores (σ=0) yields Z=0 for every evaluation; no NaN or Infinity anywhere in the computation or DB row.
**TR-4.3 — rule:** Running normalization twice returns identical normalizedTotals; re-running after one score change updates only that submission and others sharing its judges.
**TR-4.4 — rule:** PENDING/unscored assignments do not participate; deleting a score and rerunning excludes it.
**TR-4.5 — rule:** `normalizedScores` unique on `(eventId, submissionId)` — upsert overwrites, no duplicate rows.

**Status:** pending

---

## Task 5: CSV export service + audit + escaping

**Priority:** high
**Depends on:** Task 4
**ACs:** AC-22, AC-23, AC-24, AC-27
**Scope:**
- Create `src/server/judging/csv-service.ts`.
- Implement a proper CSV serializer function (no manual string concatenation):
  - RFC-4180 style: quote fields containing comma, quote, CR, or LF; double embedded quotes; CRLF line endings or LF; Unicode pass-through.
- `buildJudgingCsv(eventId)` query:
  - Join submissions → teams → tracks → normalizedScores (left).
  - Aggregate per submission: `judge_count = count of COMPLETED scores`, `raw_average = avg(rawTotal)`.
  - Required columns: `project_id, project_name, track, normalized_total`.
  - Optional columns (add when cheap via the same join): `team_name, judge_count, raw_average`.
- Export HTTP helper sets: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="export.csv"`; writes `CSV_EXPORTED` audit.

**TR-5.1 — rule:** A project name containing `","`, `"""`, and `\n` produces correctly escaped CSV output that round-trips via a standard CSV parser.
**TR-5.2 — rule:** Output row for a submission has all required columns; normalized_total is populated after normalization run (may be empty pre-run, but header still present).
**TR-5.3 — rule:** Unicode project names pass through uncorrupted.
**TR-5.4 — rule:** `CSV_EXPORTED` audit row written per export.

**Status:** pending

---

## Task 6: Judging auth helpers + Zod schemas for API routes

**Priority:** high
**Depends on:** Task 1 (schema types), Task 2 (rubric schema)
**ACs:** AC-31 (rubric safety baseline), AC-2, AC-3, AC-4, AC-23
**Scope:**
- Add to `src/server/http.ts` (or a new `src/server/judging/auth.ts`) a reusable:
  - `requireEventRole(eventId, allowedRoles[])` = calls `requireSession()` then `getEffectiveRole()` then checks allowed.
  - `requireJudgeOrOwner(eventId, requestedJudgeId?)` — ORGANIZER/SUPERADMIN pass; JUDGE role passes only if `requestedJudgeId === session.user.id`; else 403.
- Add schemas in `src/lib/api/schemas.ts`:
  - `scoreSubmissionSchema`: `{ assignmentId: uuid, judgeId?: uuid, criterionScores: Record<string, number>, comment?: string }`.
  - `assignmentCreateSchema`: `{ eventId: uuid, judgeId: uuid, submissionId: uuid }`.
  - `batchAssignSchema`: `{ eventId: uuid, submissionIds?: uuid[], judgesPerSubmission?: positiveInt }`.
  - `rubricUpsertSchema`: aligned with Task 2's rubric validation Zod shape.
- Wire HTTP status codes: use `NextResponse.json(..., { status: 400/401/403/404/409 })` consistently, matching `authErrorResponse` patterns.

**TR-6.1 — rule:** Unit test for requireJudgeOrOwner: judgeA + requested=judgeA passes; judgeA + requested=judgeB throws 403; organizer with any requested passes; participant throws 403.
**TR-6.2 — rule:** Zod scoreSubmissionSchema rejects non-uuid assignmentId, non-number criterion scores, negative, >100, or NaN values.

**Status:** pending

---

## Task 7: Judge & Organizer Assignment API routes

**Priority:** high
**Depends on:** Task 3, Task 6
**ACs:** AC-12, AC-13, AC-14, FR-12 scope
**Scope:**
- `app/api/judge/assignments/route.ts` — GET:
  - Session → effective role; JUDGE role filters assignments to `judgeId = session.user.id`; ORGANIZER sees all for the event (or scoped by query `eventId`).
  - Query params: `eventId` (required), optional `status=PENDING|COMPLETED`.
  - Returns `{assignments: [...]}` with submission title, team name, track, status joined.
- `app/api/organizer/judge-assignments/route.ts` — GET/POST:
  - GET: returns all assignments + per-judge progress (assigned/completed/pending/progress%) for the event (AC-26 baseline via same query).
  - POST single: validate & call `createAssignment`.
  - POST batch: `{mode: "batch", …}` → `assignProjectsToJudges(...)` — returns counts created / skipped-duplicate / skipped-ineligible.
- Authorization: `requireEventRole(eventId, ["JUDGE","ORGANIZER","SUPERADMIN"])` for judge route but JUDGE-scoped; organizer route requires ORGANIZER/SUPERADMIN.

**TR-7.1 — rule:** Judge GET returns only their own assignments; POST-ing to organizer endpoint as JUDGE → 403.
**TR-7.2 — rule:** Single assignment POST creates row when valid; duplicate returns 409; wrong-event returns 404/400.

**Status:** pending

---

## Task 8: Judge scores GET/POST endpoints (acceptance-critical for run.py)

**Priority:** highest
**Depends on:** Task 2, Task 6, Task 7 (assignment context)
**ACs:** AC-2, AC-3, AC-4, AC-7, AC-8, AC-9, AC-10, AC-11, AC-15, AC-16, AC-27
**Scope:**
- `app/api/judge/scores/route.ts`:
  - **GET**:
    - Query params: `judge=UUID` (required), `eventId=UUID` (required).
    - Auth pipeline: session → getEffectiveRole(eventId).
      - JUDGE: `judge` param MUST equal session.user.id (else 403).
      - ORGANIZER/SUPERADMIN: allow any judgeId.
      - PARTICIPANT: 403.
    - Return `{scores: [...]}` joined with assignment, submission title, rubric info.
    - **This is the exact endpoint hit by `run.py` T2 checks (judge_scores / peer_scores routes).**
  - **POST**:
    - Body parsed with `scoreSubmissionSchema`.
    - Load assignment; verify eventId on assignment matches target event.
    - Load effective role; JUDGE role must own the assignment (`assignment.judgeId === session.user.id`); ORGANIZER bypass allowed for audit/remediation.
    - Ensure assignment still PENDING (allow resubmission flag only if explicit ORGANIZER override).
    - Load rubric (event-level by default; track-specific if a `rubrics.trackId` row matches).
    - Validate criterion scores, compute `rawTotal` server-side via Task 2.
    - Upsert `scores` by assignmentId unique: if already present and assignment COMPLETED → 409 unless override.
    - Mark `judgeAssignments.status = 'COMPLETED'`.
    - Write `SCORE_SUBMITTED` (or `SCORE_UPDATED` on resubmit) audit.
- Register GET route pattern in `.dogfood.toml` routes with the exact URLs run.py will call (see Task 15).

**TR-8.1 — rule:** HTTP-level tests using supertest mirroring run.py:
  - participant → judge_scores → 403.
  - judgeA → judgeA scores → 200.
  - judgeB → judgeA scores → 403.
**TR-8.2 — rule:** POST creates score with server-calculated rawTotal equal to expected weighted value; client-provided rawTotal in body (if any) is ignored.
**TR-8.3 — rule:** POST with missing criterion, unknown criterion, out-of-range score → 400.
**TR-8.4 — rule:** POST twice for same assignment → second returns 409 unless organizer override.
**TR-8.5 — rule:** After POST, assignment.status === "COMPLETED"; audit log row exists.
**TR-8.6 — rule:** Unassigned judge trying to POST a score for another judge's assignment → 403.

**Status:** pending

---

## Task 9: Judge progress + Judge dashboard progress API

**Priority:** medium
**Depends on:** Task 7, Task 8
**ACs:** AC-25, AC-26
**Scope:**
- `app/api/judge/progress/route.ts` — GET:
  - eventId + session; JUDGE returns personal stats; ORGANIZER with `judge=UUID` returns that judge's stats (or aggregate).
  - Query: `{ assigned, completed, pending, progressPercent: completed/assigned*100 or 0 }`.
- `app/api/organizer/judging/dashboard/route.ts` — GET:
  - eventId (ORGANIZER only) → aggregate: `totalJudges, totalAssignments, completedEvaluations, pendingEvaluations, overallProgress`.
  - Per-judge progress array `[{judgeId, name, assigned, completed, pending, progress}]`.

**TR-9.1 — rule:** Progress endpoints return counts consistent with actual judge_assignments + scores join; seeding new assignments and refreshing changes counts by the expected delta.
**TR-9.2 — rule:** Judge progress API returns 403 if participant calls it; returns 403 when judge attempts to query peer progress directly.

**Status:** pending

---

## Task 10: Rubric management, Normalize trigger, CSV export API routes

**Priority:** high
**Depends on:** Task 2, Task 4, Task 5, Task 6
**ACs:** AC-5, AC-6, AC-19, AC-20, AC-22, AC-23, AC-24, AC-27
**Scope:**
- `app/api/organizer/rubrics/route.ts` (GET/POST, organizer-only):
  - Upsert rubric by eventId (+optional trackId). Validate per Task 2. Return created/updated rubric.
- `app/api/organizer/judging/normalize/route.ts` — POST (organizer-only):
  - Call `runNormalization(eventId, actorId)`. Return `{submissionsUpdated: N, calculatedAt: ISO}`.
- `app/api/organizer/export/route.ts` — GET (organizer-only, **this is csv_export in run.py**):
  - `eventId` query param.
  - Call CSV service; return `new NextResponse(csvString, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="export.csv"' } })`.
  - Authorization: event role ORGANIZER/SUPERADMIN → allow; JUDGE or PARTICIPANT → 403.

**TR-10.1 — rule:** CSV endpoint returns text/csv content type + attachment disposition; first line has a comma; participant call returns 403; judge call returns 403.
**TR-10.2 — rule:** Normalize POST updates normalizedScores table with values matching the hand-calculated fixture example (from Task 4 TRs).
**TR-10.3 — rule:** Rubric POST rejects bad weights with 400 and an error body mentioning "weight" or "sum".

**Status:** pending

---

## Task 11: Judge Dashboard UI

**Priority:** medium
**Depends on:** Task 9 (progress API), Task 7 (assignments list API), Task 8 (scores API)
**ACs:** AC-25, AC-34 (rubric)
**Scope:**
- `app/judge/dashboard/page.tsx`:
  - Server component or client fetches via api-client (add methods).
  - Progress card: Assigned / Completed / Pending / Progress % from Task 9 API.
  - Assigned projects list: each row shows title, team, track, status (PENDING/COMPLETED), link to evaluation page with `assignmentId` param.
  - Scope: renders only for users with JUDGE+ effective role on the selected event; others get "Not authorized" UI + redirect.
- Add client API methods to `lib/api-client.ts`: `getJudgeAssignments(eventId)`, `getJudgeProgress(eventId)`.

**TR-11.1 — rule:** Dashboard numbers match DB-derived values after running fixtures + seed; a manual DB insert changes the numbers on reload.
**TR-11.2 — rule:** Judge sees only own assignments; an attempt to inject peer assignmentId in the list query returns filtered data at API layer (Task 7 TR-7.1).

**Status:** pending

---

## Task 12: Judge Evaluation Page UI

**Priority:** medium
**Depends on:** Task 11, Task 8 (POST scores), Task 10 (rubric GET)
**ACs:** AC-7, AC-34
**Scope:**
- `app/judge/evaluate/[assignmentId]/page.tsx`:
  - Load assignment + submission + rubric via APIs.
  - Display project title, team name, track, description, repo/demo links, tagline.
  - Rubric criteria rendered as sliders/inputs 0–100 with labels and weights shown.
  - Client-side weighted total preview (calculated locally the same way server will; server is authoritative on save).
  - Optional comment textarea.
  - Submit button → POST `/api/judge/scores`; on success return to dashboard with COMPLETED badge visible.
  - Re-display prior submitted score values if COMPLETED.

**TR-12.1 — rule:** After submit, scores.rawTotal in DB equals server-computed value; client preview and DB value match for valid inputs.
**TR-12.2 — rule:** Invalid values (out of range, missing) show inline validation error and do not issue a successful server POST.

**Status:** pending

---

## Task 13: Organizer Judging Management UI

**Priority:** medium
**Depends on:** Task 9, Task 10, Task 7
**ACs:** AC-26, AC-34
**Scope:**
- `app/organizer/judging/page.tsx`:
  - Tabs or sections:
    1. Judges list (event roles JUDGE) + track expertise (judgeTracks).
    2. Assignments: table with filters + "Batch assign" button calling batch-assign endpoint.
    3. Progress aggregate card + per-judge progress table.
    4. Rubric config: editable criteria list with weight sum validation (calls rubric POST).
    5. Normalize button (calls normalize POST), shows last normalizedAt timestamp.
    6. Results: submissions ranked by normalizedTotal; CSV export download button hits `/api/organizer/export`.
- Authorize page server-side by ORGANIZER event role; PARTICIPANT → forbidden; JUDGE → forbidden.

**TR-13.1 — rule:** All cards/numbers populated from DB; running normalize updates results list ordering.
**TR-13.2 — rule:** CSV export download link produces a file with the expected header row.

**Status:** pending

---

## Task 14: T2 Comprehensive test suite (Vitest)

**Priority:** highest
**Depends on:** Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10 (incremental test authoring alongside implementation is expected, but the final full suite runs only when endpoints exist)
**ACs:** AC-2 through AC-28, AC-32 (rubric)
**Scope:**
- Add `tests/t2/authorization.test.ts` covering:
  - participant → judge scores = 403
  - judgeA → own scores = 200; judgeB → judgeA = 403
  - organizer CSV succeeds; judge/participant CSV = 403
- Add `tests/t2/assignment.test.ts`: valid assignment, duplicate assignment (409), ineligible judge (rejected), wrong-event submission (rejected).
- Add `tests/t2/score-submission.test.ts`: assigned judge scores OK; unassigned/participant → 403; unknown/missing criterion → 400; bad score → 400; rawTotal server-calculated; duplicate score → 409.
- Add `tests/t2/normalization.test.ts`: mean, std dev (population), z-score (pure functions each + edge cases); zero σ → Z=0; multi-judge/multi-project end-to-end; recalc idempotency.
- Add `tests/t2/csv.test.ts`: organizer succeeds; headers present; normalized_total column contains expected post-normalize value; Content-Type/Content-Disposition correct; CSV escape round-trip.
- Add `tests/t2/rubric.test.ts`: validation rule coverage (weights sum, duplicates, negatives, empty, missing labels).
- All tests reuse the same DB setup pattern as existing tests (`beforeAll`/`beforeEach` migrations + seed if needed).

**TR-14.1 — rule:** `pnpm test` completes with 0 failures overall (T1 preserved, T2 new tests all green).
**TR-14.2 — rule:** `pnpm acceptance` (Vitest + run-acceptance) succeeds.

**Status:** pending

---

## Task 15: .dogfood.toml + acceptance harness wiring

**Priority:** highest
**Depends on:** Task 8, Task 10
**ACs:** AC-28
**Scope:**
- Create/update `d:\dogfood\DogFood_draft\.dogfood.toml`:
  - `[portal]` base_url (matches dev or configured host).
  - `[tiers]` claimed = ["T1","T2"].
  - `[auth]` judge_a, judge_b, participant, organizer entries containing `Cookie: <session token>` acquired via login/impersonation against seeded fixture judges (or via CLI script in run-acceptance.ts to obtain cookies).
  - `[routes]` with exact working URL patterns for:
    - `judge_scores = "<base>/api/judge/scores?eventId=<fixtureEventId>&judge=<judgeAId>"`
    - `peer_scores = "<base>/api/judge/scores?eventId=<fixtureEventId>&judge=<judgeAId>"`  (so judge_b using it → 403)
    - `csv_export = "<base>/api/organizer/export?eventId=<fixtureEventId>"`
    - plus any existing T1 routes (gallery, submit) unchanged.
- Update `scripts/run-acceptance.ts` if needed to: start server, run fixtures, acquire cookies for the 4 persona by impersonating/logging in as them, write them into a derived `.dogfood.runtime.toml`, then invoke `python3 scripts/run.py`.
- Ensure fixture judgeA / judgeB identities resolve correctly to the loaded fixture event's judges.

**TR-15.1 — rule:** Running `pnpm acceptance` end-to-end reports T2 verified.
**TR-15.2 — rule:** .dogfood.toml keys exactly match run.py expected structure.

**Status:** pending

---

## Task 16: Documentation updates (JUDGING.md, DATA-MODEL.md, ARCHITECTURE.md)

**Priority:** low
**Depends on:** All tasks implemented & tests green
**ACs:** (Documentation coverage rubric under AC-31 AC-33 intent)
**Scope:**
- `docs/JUDGING.md`: document judge assignment flow, rubric validation rules, weighted scoring math, backend auth pipeline, role isolation, Z-score normalization formula + zero-variance rule, progress calc, CSV export auth, security invariants, acceptance scenarios (with run.py URLs).
- `docs/DATA-MODEL.md`: add `normalized_scores` alongside existing tables; show relationships (events → rubrics ↔ tracks; events → judge_assignments ↔ users ↔ submissions → scores → normalized_scores).
- `docs/ARCHITECTURE.md`: T2 service layer diagram summary, API route map.

**TR-16.1 — rule:** Documented normalization formula exactly matches the implementation (population σ, per-judge mean, Z=0 on σ=0).

**Status:** pending

---

## Task 17: Final verification (tests + acceptance + Docker)

**Priority:** highest
**Depends on:** Tasks 1–16 complete
**ACs:** AC-1, AC-28, AC-29, AC-30, all remaining rules
**Scope:**
- Run locally:
  1. `pnpm db:migrate` (fresh and existing DB both)
  2. `pnpm db:seed`
  3. `pnpm db:fixtures`
  4. `pnpm test`
  5. `pnpm acceptance`
  6. `docker compose up --build` (confirm starts cleanly; no network calls needed beyond local postgres)
- Fix any regressions, update tasks.md Completion Evidence per task.

**TR-17.1 — rule:** All commands above exit 0; docker logs show no crash loop.

**Status:** pending
