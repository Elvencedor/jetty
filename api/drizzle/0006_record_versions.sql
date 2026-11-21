ALTER TABLE "categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_entries" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_prep_times" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Same rule as products (0005): the database moves the version up by one on every update, so no write path can forget
-- it, repeat a value or send it backwards.
CREATE FUNCTION "bump_version"() RETURNS trigger AS $$
BEGIN
	NEW."version" := OLD."version" + 1;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "collections" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "content_entries" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "delivery_zones" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "delivery_prep_times" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "store_settings" FOR EACH ROW EXECUTE FUNCTION "bump_version"();
--> statement-breakpoint
-- A redemption only counts up usage_count. That is not an edit, so it must not make an admin's open form stale.
CREATE FUNCTION "promotions_bump_version"() RETURNS trigger AS $$
BEGIN
	IF NEW."usage_count" IS DISTINCT FROM OLD."usage_count"
		AND (to_jsonb(NEW) - 'usage_count' - 'updated_at' - 'version') = (to_jsonb(OLD) - 'usage_count' - 'updated_at' - 'version') THEN
		NEW."version" := OLD."version";
	ELSE
		NEW."version" := OLD."version" + 1;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "bump_version" BEFORE UPDATE ON "promotions" FOR EACH ROW EXECUTE FUNCTION "promotions_bump_version"();
