import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, boolean, integer } from "drizzle-orm/pg-core";
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
});

export const insertLiquidationSchema = createInsertSchema(liquidations).omit({
  id: true,
  timestamp: true,
});

export type InsertLiquidation = z.infer<typeof insertLiquidationSchema>;
export type Liquidation = typeof liquidations.$inferSelect;

// User table for future authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User settings table for persistent preferences
export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(), // Browser session ID
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

// Risk management settings table - configurable position limits and cascade protection
export const riskSettings = pgTable("risk_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(), // Per-session risk settings
  
  // Position Limits
  maxPortfolioExposurePercent: decimal("max_portfolio_exposure_percent", { precision: 5, scale: 2 }).notNull().default('80.00'),
  warningPortfolioExposurePercent: decimal("warning_portfolio_exposure_percent", { precision: 5, scale: 2 }).notNull().default('60.00'),
  maxSymbolConcentrationPercent: decimal("max_symbol_concentration_percent", { precision: 5, scale: 2 }).notNull().default('20.00'),
  maxPositionsPerSymbol: integer("max_positions_per_symbol").notNull().default(2),
  maxPositionSizePercent: decimal("max_position_size_percent", { precision: 5, scale: 2 }).notNull().default('5.00'),
  minPositionSize: decimal("min_position_size", { precision: 18, scale: 8 }).notNull().default('1.00'),
  maxRiskPerTradePercent: decimal("max_risk_per_trade_percent", { precision: 5, scale: 2 }).notNull().default('2.00'),
  
  // Volatility Limits
  highVolatilityThreshold: decimal("high_volatility_threshold", { precision: 5, scale: 2 }).notNull().default('15.00'),
  extremeVolatilityThreshold: decimal("extreme_volatility_threshold", { precision: 5, scale: 2 }).notNull().default('20.00'),
  
  // Cascade Protection Settings  
  cascadeDetectionEnabled: boolean("cascade_detection_enabled").notNull().default(true),
  cascadeCooldownMinutes: integer("cascade_cooldown_minutes").notNull().default(10),
  
  // Cascade Detection Thresholds
  lowLiquidationCount: integer("low_liquidation_count").notNull().default(3),
  mediumLiquidationCount: integer("medium_liquidation_count").notNull().default(7),
  highLiquidationCount: integer("high_liquidation_count").notNull().default(15),
  extremeLiquidationCount: integer("extreme_liquidation_count").notNull().default(25),
  
  lowVelocityPerMinute: decimal("low_velocity_per_minute", { precision: 5, scale: 2 }).notNull().default('2.00'),
  mediumVelocityPerMinute: decimal("medium_velocity_per_minute", { precision: 5, scale: 2 }).notNull().default('5.00'),
  highVelocityPerMinute: decimal("high_velocity_per_minute", { precision: 5, scale: 2 }).notNull().default('10.00'),
  extremeVelocityPerMinute: decimal("extreme_velocity_per_minute", { precision: 5, scale: 2 }).notNull().default('20.00'),
  
  lowVolumeThreshold: decimal("low_volume_threshold", { precision: 18, scale: 2 }).notNull().default('50000.00'),
  mediumVolumeThreshold: decimal("medium_volume_threshold", { precision: 18, scale: 2 }).notNull().default('200000.00'),
  highVolumeThreshold: decimal("high_volume_threshold", { precision: 18, scale: 2 }).notNull().default('500000.00'),
  extremeVolumeThreshold: decimal("extreme_volume_threshold", { precision: 18, scale: 2 }).notNull().default('1000000.00'),
  
  // Analysis Window Settings
  cascadeAnalysisWindowMinutes: integer("cascade_analysis_window_minutes").notNull().default(10),
  systemWideCascadeWindowMinutes: integer("system_wide_cascade_window_minutes").notNull().default(15),
  
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRiskSettingsSchema = createInsertSchema(riskSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRiskSettings = z.infer<typeof insertRiskSettingsSchema>;
export type RiskSettings = typeof riskSettings.$inferSelect;

// Trading strategies table
export const tradingStrategies = pgTable("trading_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // "counter_liquidation", "volatility", "custom"
  isActive: boolean("is_active").notNull().default(false),
  riskRewardRatio: decimal("risk_reward_ratio", { precision: 10, scale: 2 }).notNull(),
  maxPositionSize: decimal("max_position_size", { precision: 18, scale: 8 }).notNull(),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 2 }).notNull(),
  takeProfitPercent: decimal("take_profit_percent", { precision: 5, scale: 2 }).notNull(),
  volatilityThreshold: decimal("volatility_threshold", { precision: 5, scale: 2 }).notNull(),
  liquidationThresholdPercentile: decimal("liquidation_threshold_percentile", { precision: 5, scale: 2 }).notNull().default('50.00'),
  cascadeDetectionEnabled: boolean("cascade_detection_enabled").notNull().default(true),
  cascadeCooldownMinutes: integer("cascade_cooldown_minutes").notNull().default(10),
  symbols: text("symbols").array().notNull().default(sql`'{}'::text[]`),
  sessionId: text("session_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Portfolio state table
export const portfolios = pgTable("portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  paperBalance: decimal("paper_balance", { precision: 18, scale: 8 }).notNull().default('10000.00'),
  realBalance: decimal("real_balance", { precision: 18, scale: 8 }).notNull().default('0.00'),
  totalPnl: decimal("total_pnl", { precision: 18, scale: 8 }).notNull().default('0.00'),
  paperPnl: decimal("paper_pnl", { precision: 18, scale: 8 }).notNull().default('0.00'),
  realPnl: decimal("real_pnl", { precision: 18, scale: 8 }).notNull().default('0.00'),
  tradingMode: text("trading_mode").notNull().default('paper'), // "paper" or "real"
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

// Positions table (open positions)
export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  portfolioId: varchar("portfolio_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal("current_price", { precision: 18, scale: 8 }).notNull(),
  stopLossPrice: decimal("stop_loss_price", { precision: 18, scale: 8 }),
  takeProfitPrice: decimal("take_profit_price", { precision: 18, scale: 8 }),
  unrealizedPnl: decimal("unrealized_pnl", { precision: 18, scale: 8 }).notNull().default('0.00'),
  tradingMode: text("trading_mode").notNull(), // "paper" or "real"
  status: text("status").notNull().default('open'), // "open", "closed", "liquidated"
  triggeredByLiquidation: varchar("triggered_by_liquidation"), // liquidation ID that triggered this
  volatilityAtEntry: decimal("volatility_at_entry", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trades table (completed trades)
export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  positionId: varchar("position_id").notNull(),
  strategyId: varchar("strategy_id").notNull(),
  portfolioId: varchar("portfolio_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  size: decimal("size", { precision: 18, scale: 8 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 18, scale: 8 }).notNull(),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }).notNull(),
  feesPaid: decimal("fees_paid", { precision: 18, scale: 8 }).notNull().default('0.00'),
  tradingMode: text("trading_mode").notNull(), // "paper" or "real"
  exitReason: text("exit_reason").notNull(), // "stop_loss", "take_profit", "manual", "liquidated"
  triggeredByLiquidation: varchar("triggered_by_liquidation"), // liquidation ID that triggered this
  duration: integer("duration_seconds"), // Trade duration in seconds
  volatilityAtEntry: decimal("volatility_at_entry", { precision: 5, scale: 2 }),
  volatilityAtExit: decimal("volatility_at_exit", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at").notNull().defaultNow(),
});

// Market data cache for volatility calculations
export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  volume: decimal("volume", { precision: 18, scale: 8 }).notNull(),
  volatility24h: decimal("volatility_24h", { precision: 5, scale: 2 }),
  volatility1h: decimal("volatility_1h", { precision: 5, scale: 2 }),
  liquidationPressure: decimal("liquidation_pressure", { precision: 5, scale: 2 }),
  cascadeRisk: text("cascade_risk").notNull().default('low'), // "low", "medium", "high"
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Zod schemas for trading entities
export const insertTradingStrategySchema = createInsertSchema(tradingStrategies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPortfolioSchema = createInsertSchema(portfolios).omit({
  id: true,
  lastUpdated: true,
});

export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTradeSchema = createInsertSchema(trades).omit({
  id: true,
  createdAt: true,
  closedAt: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  timestamp: true,
});

// Type exports for trading entities
export type InsertTradingStrategy = z.infer<typeof insertTradingStrategySchema>;
export type TradingStrategy = typeof tradingStrategies.$inferSelect;

export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfolios.$inferSelect;

export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positions.$inferSelect;

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type MarketData = typeof marketData.$inferSelect;