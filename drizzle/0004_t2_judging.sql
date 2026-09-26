ALTER TABLE "rubrics" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE
    dup_count integer;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT "assignment_id"
        FROM "scores"
        GROUP BY "assignment_id"
        HAVING COUNT(*) > 1
    ) AS dups;

    IF dup_count > 0 THEN
        DELETE FROM "scores" s1
        USING "scores" s2
        WHERE s1."assignment_id" = s2."assignment_id"
          AND s1."id" <> s2."id"
          AND (s1."submitted_at" IS NULL OR s1."submitted_at" <= COALESCE(s2."submitted_at", '-infinity'::timestamptz))
          AND s1."ctid" < s2."ctid";
    END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_assignment_unique" ON "scores" USING btree ("assignment_id");--> statement-breakpoint
CREATE TABLE "normalized_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"normalized_total" real NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normalized_score_unique" UNIQUE("event_id","submission_id")
);
--> statement-breakpoint
ALTER TABLE "normalized_scores" ADD CONSTRAINT "normalized_scores_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_scores" ADD CONSTRAINT "normalized_scores_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;
