ALTER TABLE "delivery_zones" ALTER COLUMN "state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "scope" text DEFAULT 'state' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "states" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "delivery_fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "delivery_min_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD COLUMN "delivery_max_days" integer DEFAULT 3 NOT NULL;
-- Carry each zone over to the single price: the nationwide price wins, then next-day, then same-day, and the duration
-- is the one that goes with the price that was kept. Zones that offered nothing stay pickup only (null price).
-- Every existing zone covers the one state it already named (scope 'state').
UPDATE "delivery_zones" SET
	"delivery_fee_minor" = COALESCE("nationwide_fee_minor", "next_day_fee_minor", "same_day_fee_minor"),
	"delivery_min_days" = CASE WHEN "nationwide_fee_minor" IS NOT NULL THEN 2 WHEN "next_day_fee_minor" IS NOT NULL THEN 1 ELSE 0 END,
	"delivery_max_days" = CASE WHEN "nationwide_fee_minor" IS NOT NULL THEN 4 WHEN "next_day_fee_minor" IS NOT NULL THEN 1 ELSE 0 END
WHERE "nationwide_fee_minor" IS NOT NULL OR "next_day_fee_minor" IS NOT NULL OR "same_day_fee_minor" IS NOT NULL;
