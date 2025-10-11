CREATE TABLE "position_layers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" varchar NOT NULL,
	"layer_number" integer NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"cost" numeric(18, 8) NOT NULL,
	"take_profit_price" numeric(18, 8) NOT NULL,
	"stop_loss_price" numeric(18, 8) NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"realized_pnl" numeric(18, 8) DEFAULT '0.0' NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "position_layers_position_id_layer_number_unique" UNIQUE("position_id","layer_number")
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "adaptive_sl_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "sl_atr_multiplier" numeric(5, 2) DEFAULT '2.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "min_sl_percent" numeric(5, 2) DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "max_sl_percent" numeric(5, 2) DEFAULT '5.0' NOT NULL;