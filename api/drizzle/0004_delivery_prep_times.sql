CREATE TABLE "delivery_prep_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'days' NOT NULL,
	"days" integer,
	"delivers_from" text,
	"active_from" text,
	"active_until" text,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"zone_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
