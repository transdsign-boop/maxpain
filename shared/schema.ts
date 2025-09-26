import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, boolean } from "drizzle-orm/pg-core";
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