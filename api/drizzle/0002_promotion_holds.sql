CREATE TABLE "promotion_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"promotion_code_id" uuid,
	"customer_id" uuid,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotion_holds" ADD CONSTRAINT "promotion_holds_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_holds" ADD CONSTRAINT "promotion_holds_promotion_code_id_promotion_codes_id_fk" FOREIGN KEY ("promotion_code_id") REFERENCES "public"."promotion_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_holds" ADD CONSTRAINT "promotion_holds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_holds" ADD CONSTRAINT "promotion_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_holds_promotion_order_uq" ON "promotion_holds" USING btree ("promotion_id","order_id");--> statement-breakpoint
CREATE INDEX "promotion_holds_code_idx" ON "promotion_holds" USING btree ("promotion_code_id");--> statement-breakpoint
CREATE INDEX "promotion_holds_customer_idx" ON "promotion_holds" USING btree ("promotion_id","customer_id");--> statement-breakpoint
CREATE INDEX "promotion_holds_order_idx" ON "promotion_holds" USING btree ("order_id");