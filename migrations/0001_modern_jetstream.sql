CREATE TABLE "trade_entry_errors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"strategy_id" varchar,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"attempt_type" text NOT NULL,
	"reason" text NOT NULL,
	"error_details" text,
	"liquidation_value" numeric(18, 8),
	"strategy_settings" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "adaptive_tp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "tp_atr_multiplier" numeric(5, 2) DEFAULT '1.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "min_tp_percent" numeric(5, 2) DEFAULT '0.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "max_tp_percent" numeric(5, 2) DEFAULT '5.0' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_trade_errors_user_time" ON "trade_entry_errors" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_trade_errors_symbol" ON "trade_entry_errors" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_trade_errors_reason" ON "trade_entry_errors" USING btree ("reason");