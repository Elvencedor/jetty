-- There is no 7-day return window. Forget the removed setting wherever it was saved.
UPDATE "store_settings" SET "value" = "value" - 'returnWindowDays', "updated_at" = now()
WHERE "key" = 'app.policies' AND "value" ? 'returnWindowDays';
--> statement-breakpoint
-- Drop the limit from the seeded returns page. Only the starter sentence is matched, so wording the owner has rewritten
-- is left alone.
UPDATE "content_entries"
SET "body" = jsonb_set("body", '{markdown}', to_jsonb(replace("body"->>'markdown', 'within **7 days of delivery** if', 'if'))), "updated_at" = now()
WHERE "content_type" = 'page' AND "slug" = 'returns' AND strpos("body"->>'markdown', 'within **7 days of delivery** if') > 0;
