import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, boolean, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const liquidations = pgTable("liquidations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  value: decimal("value", { precision: 18, scale: 8 }).notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  eventTimestamp: varchar("event_timestamp").unique(), // Aster DEX event timestamp (E field) - unique per event
});

export const insertLiquidationSchema = createInsertSchema(liquidations).omit({
  id: true,
  timestamp: true,
}).extend({
  eventTimestamp: z.string().optional(),
});

export type InsertLiquidation = z.infer<typeof insertLiquidationSchema>;
export type Liquidation = typeof liquidations.$inferSelect;

// Session storage table for Replit Auth (passport sessions)
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// User settings table for persistent preferences
export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(), // Replit Auth user ID
  selectedAssets: text("selected_assets").array().notNull().default(sql`'{}'::text[]`),
  sideFilter: text("side_filter").notNull().default('all'),
  minValue: text("min_value").notNull().default('0'),
  timeRange: text("time_range").notNull().default('1h'),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  lastUpdated: true,
});

export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

// Trading Strategy Configuration
export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  userId: varchar("user_id").notNull(), // Replit Auth user ID
  selectedAssets: text("selected_assets").array().notNull(),
  percentileThreshold: integer("percentile_threshold").notNull().default(50), // 1-100%
  liquidationLookbackHours: integer("liquidation_lookback_hours").notNull().default(1), // 1-24 hours
  maxLayers: integer("max_layers").notNull().default(5),
  positionSizePercent: decimal("position_size_percent", { precision: 5, scale: 2 }).notNull(), // % of portfolio per position
  profitTargetPercent: decimal("profit_target_percent", { precision: 5, scale: 2 }).notNull().default("1.0"),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 2 }).notNull().default("2.0"), // Stop loss percentage
  // Margin and Risk Management
  marginMode: text("margin_mode").notNull().default("cross"), // "cross" or "isolated"
  leverage: integer("leverage").notNull().default(1), // 1-125x leverage
  // Smart Order Placement
  orderDelayMs: integer("order_delay_ms").notNull().default(1000), // Delay before placing orders (milliseconds)
  slippageTolerancePercent: decimal("slippage_tolerance_percent", { precision: 5, scale: 2 }).notNull().default("0.5"), // Max slippage %
  orderType: text("order_type").notNull().default("limit"), // "market" or "limit"
  maxRetryDurationMs: integer("max_retry_duration_ms").notNull().default(30000), // How long to chase price before giving up (milliseconds)
  marginAmount: decimal("margin_amount", { precision: 5, scale: 2 }).notNull().default("10.0"), // Percentage of account to use for trading
  tradingMode: text("trading_mode").notNull().default("paper"), // "paper" or "live"
  paperAccountSize: decimal("paper_account_size", { precision: 18, scale: 2 }).notNull().default("10000.0"), // Starting balance for paper trading
  hedgeMode: boolean("hedge_mode").notNull().default(false), // Allow simultaneous long and short positions on same asset
  isActive: boolean("is_active").notNull().default(false),
  paused: boolean("paused").notNull().default(false), // Temporarily pause trading without deactivating strategy
  liveSessionStartedAt: timestamp("live_session_started_at"), // Tracks when current live session began (null when in paper mode)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trading Sessions for Paper Trading
export const tradeSessions = pgTable("trade_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(), // References strategies.id
  mode: text("mode").notNull().default("paper"), // "paper" or "live"
  startingBalance: decimal("starting_balance", { precision: 18, scale: 8 }).notNull().default("10000.0"),
  currentBalance: decimal("current_balance", { precision: 18, scale: 8 }).notNull(),
  totalPnl: decimal("total_pnl", { precision: 18, scale: 8 }).notNull().default("0.0"),
  totalTrades: integer("total_trades").notNull().default(0),
  winRate: decimal("win_rate", { precision: 5, scale: 2 }).notNull().default("0.0"),
  isActive: boolean("is_active").notNull().default(true),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

// Order Records
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(), // References tradeSessions.id
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "buy" or "sell"
  orderType: text("order_type").notNull().default("market"), // "market" or "limit"
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }),
  status: text("status").notNull().default("pending"), // "pending", "filled", "partial", "cancelled"
  triggerLiquidationId: varchar("trigger_liquidation_id"), // References liquidations.id
  layerNumber: integer("layer_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  filledAt: timestamp("filled_at"),
});

// Fill Records (Order Executions)
export const fills = pgTable("fills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(), // References orders.id
  sessionId: varchar("session_id").notNull(), // References tradeSessions.id
  positionId: varchar("position_id"), // References positions.id (nullable for backwards compatibility)
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "buy" or "sell"
  quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  value: decimal("value", { precision: 18, scale: 8 }).notNull(),
  fee: decimal("fee", { precision: 18, scale: 8 }).notNull().default("0.0"),
  layerNumber: integer("layer_number").notNull(),
  filledAt: timestamp("filled_at").notNull().defaultNow(),
});

// Current Positions
export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(), // References tradeSessions.id
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  totalQuantity: decimal("total_quantity", { precision: 18, scale: 8 }).notNull(),
  avgEntryPrice: decimal("avg_entry_price", { precision: 18, scale: 8 }).notNull(),
  totalCost: decimal("total_cost", { precision: 18, scale: 8 }).notNull(),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).notNull().default("0.0"),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).notNull().default("0.0"),
  layersFilled: integer("layers_filled").notNull().default(1),
  maxLayers: integer("max_layers").notNull(),
  lastLayerPrice: decimal("last_layer_price", { precision: 18, scale: 8 }),
  isOpen: boolean("is_open").notNull().default(true),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// P&L Snapshots for Analytics
export const pnlSnapshots = pgTable("pnl_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(), // References tradeSessions.id
  balance: decimal("balance", { precision: 18, scale: 8 }).notNull(),
  totalPnl: decimal("total_pnl", { precision: 18, scale: 8 }).notNull(),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).notNull(),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).notNull(),
  totalTrades: integer("total_trades").notNull(),
  activePositions: integer("active_positions").notNull(),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
});

// Schema exports for strategies
export const insertStrategySchema = createInsertSchema(strategies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Frontend-specific schema that matches what TradingControlPanel sends
export const frontendStrategySchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(50, "Name too long"),
  userId: z.string(),
  selectedAssets: z.array(z.string()).min(1, "Select at least one asset"),
  percentileThreshold: z.number().min(1).max(100),
  maxLayers: z.number().min(1).max(10),
  positionSizePercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 50;
  }, "Position size must be between 0.1% and 50%"),
  profitTargetPercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 20;
  }, "Profit target must be between 0.1% and 20%"),
  stopLossPercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 50;
  }, "Stop loss must be between 0.1% and 50%").default("2.0"),
  // Margin and Risk Management
  marginMode: z.enum(["cross", "isolated"]).default("cross"),
  leverage: z.number().min(1).max(125).default(1), // 1-125x leverage
  // Smart Order Placement
  orderDelayMs: z.number().min(100).max(30000).default(1000), // 100ms to 30s
  slippageTolerancePercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 5;
  }, "Slippage tolerance must be between 0.1% and 5%").default("0.5"),
  orderType: z.enum(["market", "limit"]).default("limit"),
  maxRetryDurationMs: z.number().min(5000).max(300000).default(30000), // 5s to 5min
  marginAmount: z.string().refine((val) => {
    const num = parseFloat(val);
    return num >= 1 && num <= 100;
  }, "Account usage must be between 1% and 100%").default("10.0"),
  tradingMode: z.enum(["paper", "live"]).default("paper"),
  paperAccountSize: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 100 && num <= 1000000;
  }, "Paper account size must be between $100 and $1,000,000").default("10000.0"),
  hedgeMode: z.boolean().default(false),
  isActive: z.boolean().optional().default(false),
});

// Update schema for partial updates
export const updateStrategySchema = frontendStrategySchema.partial().omit({
  userId: true, // Don't allow changing user
});

export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type FrontendStrategy = z.infer<typeof frontendStrategySchema>;
export type UpdateStrategy = z.infer<typeof updateStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

// Schema exports for trade sessions
export const insertTradeSessionSchema = createInsertSchema(tradeSessions).omit({
  id: true,
  startedAt: true,
  endedAt: true,
});

export type InsertTradeSession = z.infer<typeof insertTradeSessionSchema>;
export type TradeSession = typeof tradeSessions.$inferSelect;

// Schema exports for orders
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  filledAt: true,
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Schema exports for fills
export const insertFillSchema = createInsertSchema(fills).omit({
  id: true,
  filledAt: true,
});

export type InsertFill = z.infer<typeof insertFillSchema>;
export type Fill = typeof fills.$inferSelect;

// Schema exports for positions
export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  openedAt: true,
  closedAt: true,
  updatedAt: true,
});

export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positions.$inferSelect;

// Schema exports for P&L snapshots
export const insertPnlSnapshotSchema = createInsertSchema(pnlSnapshots).omit({
  id: true,
  snapshotAt: true,
});

export type InsertPnlSnapshot = z.infer<typeof insertPnlSnapshotSchema>;
export type PnlSnapshot = typeof pnlSnapshots.$inferSelect;

// Strategy Changes (track modifications to running strategies)
export const strategyChanges = pgTable("strategy_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(), // References strategies.id
  sessionId: varchar("session_id").notNull(), // References tradeSessions.id
  changes: jsonb("changes").notNull(), // JSON object with changed fields {field: {old: value, new: value}}
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

export const insertStrategyChangeSchema = createInsertSchema(strategyChanges).omit({
  id: true,
  changedAt: true,
});

export type InsertStrategyChange = z.infer<typeof insertStrategyChangeSchema>;
export type StrategyChange = typeof strategyChanges.$inferSelect;