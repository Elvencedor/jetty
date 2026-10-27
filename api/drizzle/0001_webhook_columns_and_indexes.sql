ALTER TABLE "payment_webhook_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "payment_webhook_events" CASCADE;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "webhook_event_key" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "webhook_received_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_paid_placed_idx" ON "orders" USING btree ("placed_at") WHERE "orders"."payment_status" = 'paid';--> statement-breakpoint
CREATE INDEX "analytics_events_time_idx" ON "analytics_events" USING btree ("occurred_at");