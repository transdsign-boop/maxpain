CREATE TABLE "commissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"trade_id" varchar,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_commission_composite" UNIQUE("user_id","symbol","timestamp","amount")
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"session_id" varchar NOT NULL,
	"position_id" varchar,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"value" numeric(18, 8) NOT NULL,
	"fee" numeric(18, 8) DEFAULT '0.0' NOT NULL,
	"layer_number" integer NOT NULL,
	"filled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fills_order_id_session_id_unique" UNIQUE("order_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "funding_fees" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_funding_fee" UNIQUE("user_id","symbol","timestamp")
);
--> statement-breakpoint
CREATE TABLE "liquidations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"size" numeric(18, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"value" numeric(18, 8) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"event_timestamp" varchar,
	CONSTRAINT "liquidations_event_timestamp_unique" UNIQUE("event_timestamp")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text DEFAULT 'market' NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"price" numeric(18, 8),
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_liquidation_id" varchar,
	"layer_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"filled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"total_quantity" numeric(18, 8) NOT NULL,
	"avg_entry_price" numeric(18, 8) NOT NULL,
	"total_cost" numeric(18, 8) NOT NULL,
	"unrealized_pnl" numeric(18, 8) DEFAULT '0.0' NOT NULL,
	"realized_pnl" numeric(18, 8) DEFAULT '0.0' NOT NULL,
	"layers_filled" integer DEFAULT 1 NOT NULL,
	"max_layers" integer NOT NULL,
	"last_layer_price" numeric(18, 8),
	"leverage" integer DEFAULT 1 NOT NULL,
	"initial_entry_price" numeric(18, 8),
	"dca_base_size" numeric(18, 8),
	"is_open" boolean DEFAULT true NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_id" varchar NOT NULL,
	"selected_assets" text[] NOT NULL,
	"percentile_threshold" integer DEFAULT 50 NOT NULL,
	"liquidation_lookback_hours" integer DEFAULT 1 NOT NULL,
	"max_layers" integer DEFAULT 5 NOT NULL,
	"profit_target_percent" numeric(5, 2) DEFAULT '1.0' NOT NULL,
	"stop_loss_percent" numeric(5, 2) DEFAULT '2.0' NOT NULL,
	"margin_mode" text DEFAULT 'cross' NOT NULL,
	"leverage" integer DEFAULT 1 NOT NULL,
	"order_delay_ms" integer DEFAULT 1000 NOT NULL,
	"slippage_tolerance_percent" numeric(5, 2) DEFAULT '0.5' NOT NULL,
	"order_type" text DEFAULT 'limit' NOT NULL,
	"max_retry_duration_ms" integer DEFAULT 30000 NOT NULL,
	"price_chase_mode" boolean DEFAULT true NOT NULL,
	"margin_amount" numeric(5, 2) DEFAULT '10.0' NOT NULL,
	"hedge_mode" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"live_session_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"dca_start_step_percent" numeric(5, 2) DEFAULT '0.4' NOT NULL,
	"dca_spacing_convexity" numeric(5, 2) DEFAULT '1.2' NOT NULL,
	"dca_size_growth" numeric(5, 2) DEFAULT '1.8' NOT NULL,
	"dca_max_risk_percent" numeric(5, 2) DEFAULT '1.0' NOT NULL,
	"dca_volatility_ref" numeric(5, 2) DEFAULT '1.0' NOT NULL,
	"dca_exit_cushion_multiplier" numeric(5, 2) DEFAULT '0.6' NOT NULL,
	"ret_high_threshold" numeric(5, 2) DEFAULT '35.0' NOT NULL,
	"ret_medium_threshold" numeric(5, 2) DEFAULT '25.0' NOT NULL,
	"max_open_positions" integer DEFAULT 5 NOT NULL,
	"max_portfolio_risk_percent" numeric(5, 2) DEFAULT '15.0' NOT NULL,
	"risk_level" integer DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_changes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" varchar NOT NULL,
	"session_id" varchar NOT NULL,
	"changes" jsonb NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" varchar NOT NULL,
	"starting_balance" numeric(18, 8) DEFAULT '10000.0' NOT NULL,
	"current_balance" numeric(18, 8) NOT NULL,
	"total_pnl" numeric(18, 8) DEFAULT '0.0' NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"win_rate" numeric(5, 2) DEFAULT '0.0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"transaction_id" varchar,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_transfer_composite" UNIQUE("user_id","timestamp","amount","asset")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"selected_assets" text[] DEFAULT '{}'::text[] NOT NULL,
	"side_filter" text DEFAULT 'all' NOT NULL,
	"min_value" text DEFAULT '0' NOT NULL,
	"time_range" text DEFAULT '1h' NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_commissions_user_timestamp" ON "commissions" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_funding_fees_user_timestamp" ON "funding_fees" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_transfers_user_timestamp" ON "transfers" USING btree ("user_id","timestamp");