ALTER TABLE "products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- The version is the database's to keep: every UPDATE of a product moves it up by exactly one, whichever code (or
-- person) wrote it, so an edit cannot forget to bump it, repeat a value, or send it backwards.
CREATE FUNCTION "products_bump_version"() RETURNS trigger AS $$
BEGIN
	NEW."version" := OLD."version" + 1;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "products_bump_version" BEFORE UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION "products_bump_version"();
