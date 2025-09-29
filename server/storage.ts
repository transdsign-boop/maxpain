import { 
  type User, type InsertUser, type Liquidation, type InsertLiquidation, 
  type UserSettings, type InsertUserSettings,
  type Strategy, type InsertStrategy,
  type TradeSession, type InsertTradeSession,
  type Order, type InsertOrder,
  type Fill, type InsertFill,
  type Position, type InsertPosition,
  type PnlSnapshot, type InsertPnlSnapshot
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { liquidations, users, userSettings, strategies, tradeSessions, orders, fills, positions, pnlSnapshots } from "@shared/schema";
import { desc, gte, eq, sql, inArray, and } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Liquidation operations
  insertLiquidation(liquidation: InsertLiquidation): Promise<Liquidation>;
  getLiquidations(limit?: number): Promise<Liquidation[]>;
  getLiquidationsBySymbol(symbols: string[], limit?: number): Promise<Liquidation[]>;
  getLiquidationsSince(timestamp: Date, limit?: number): Promise<Liquidation[]>;
  getLargestLiquidationSince(timestamp: Date): Promise<Liquidation | undefined>;
  getLiquidationsBySignature(symbol: string, side: string, size: string, price: string, since: Date): Promise<Liquidation[]>;
  
  // Analytics operations
  getAvailableAssets(): Promise<{ symbol: string; count: number; latestTimestamp: Date }[]>;
  getLiquidationAnalytics(symbol: string, sinceTimestamp: Date): Promise<Liquidation[]>;
  
  // User settings operations
  getUserSettings(sessionId: string): Promise<UserSettings | undefined>;
  saveUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  // Trading Strategy operations
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  getStrategiesBySession(sessionId: string): Promise<Strategy[]>;
  getAllActiveStrategies(): Promise<Strategy[]>;
  updateStrategy(id: string, updates: Partial<InsertStrategy>): Promise<Strategy>;
  deleteStrategy(id: string): Promise<void>;

  // Trade Session operations
  createTradeSession(session: InsertTradeSession): Promise<TradeSession>;
  getTradeSession(id: string): Promise<TradeSession | undefined>;
  getActiveTradeSession(strategyId: string): Promise<TradeSession | undefined>;
  updateTradeSession(id: string, updates: Partial<InsertTradeSession>): Promise<TradeSession>;
  endTradeSession(id: string): Promise<TradeSession>;

  // Order operations
  placePaperOrder(order: InsertOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrdersBySession(sessionId: string): Promise<Order[]>;
  updateOrderStatus(id: string, status: string, filledAt?: Date): Promise<Order>;

  // Fill operations
  applyFill(fill: InsertFill): Promise<Fill>;
  getFillsBySession(sessionId: string): Promise<Fill[]>;
  getFillsByOrder(orderId: string): Promise<Fill[]>;

  // Position operations
  createPosition(position: InsertPosition): Promise<Position>;
  getPosition(id: string): Promise<Position | undefined>;
  getPositionBySymbol(sessionId: string, symbol: string): Promise<Position | undefined>;
  getOpenPositions(sessionId: string): Promise<Position[]>;
  updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position>;
  closePosition(id: string, closedAt: Date, realizedPnl: number): Promise<Position>;

  // P&L Snapshot operations
  createPnlSnapshot(snapshot: InsertPnlSnapshot): Promise<PnlSnapshot>;
  getPnlSnapshots(sessionId: string, limit?: number): Promise<PnlSnapshot[]>;
  getLatestPnlSnapshot(sessionId: string): Promise<PnlSnapshot | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async insertLiquidation(liquidation: InsertLiquidation): Promise<Liquidation> {
    const result = await db.insert(liquidations).values(liquidation).returning();
    return result[0];
  }

  async getLiquidations(limit: number = 100): Promise<Liquidation[]> {
    return await db.select().from(liquidations).orderBy(desc(liquidations.timestamp)).limit(limit);
  }

  async getLiquidationsBySymbol(symbols: string[], limit: number = 100): Promise<Liquidation[]> {
    if (symbols.length === 0) return [];
    
    // Use inArray for proper symbol filtering
    return await db.select()
      .from(liquidations)
      .where(inArray(liquidations.symbol, symbols))
      .orderBy(desc(liquidations.timestamp))
      .limit(limit);
  }

  async getLiquidationsBySignature(
    symbol: string, 
    side: string, 
    size: string, 
    price: string, 
    since: Date
  ): Promise<Liquidation[]> {
    // Use SQL to compare decimals numerically, not as strings
    return await db.select()
      .from(liquidations)
      .where(
        and(
          eq(liquidations.symbol, symbol),
          eq(liquidations.side, side),
          sql`CAST(${liquidations.size} AS NUMERIC) = CAST(${size} AS NUMERIC)`,
          sql`CAST(${liquidations.price} AS NUMERIC) = CAST(${price} AS NUMERIC)`,
          gte(liquidations.timestamp, since)
        )
      )
      .limit(1);
  }

  async getLiquidationsSince(timestamp: Date, limit: number = 100): Promise<Liquidation[]> {
    return await db.select()
      .from(liquidations)
      .where(gte(liquidations.timestamp, timestamp))
      .orderBy(desc(liquidations.timestamp))
      .limit(limit);
  }

  async getLargestLiquidationSince(timestamp: Date): Promise<Liquidation | undefined> {
    const result = await db.select()
      .from(liquidations)
      .where(gte(liquidations.timestamp, timestamp))
      .orderBy(desc(liquidations.value))
      .limit(1);
    return result[0];
  }

  async getUserSettings(sessionId: string): Promise<UserSettings | undefined> {
    const result = await db.select().from(userSettings).where(eq(userSettings.sessionId, sessionId));
    return result[0];
  }

  async getAvailableAssets(): Promise<{ symbol: string; count: number; latestTimestamp: Date }[]> {
    const result = await db.select({
      symbol: liquidations.symbol,
      count: sql<number>`COUNT(*)`,
      latestTimestamp: sql<Date>`MAX(${liquidations.timestamp})`
    })
    .from(liquidations)
    .groupBy(liquidations.symbol)
    .orderBy(desc(sql`COUNT(*)`));
    
    return result;
  }

  async getLiquidationAnalytics(symbol: string, sinceTimestamp: Date): Promise<Liquidation[]> {
    return await db.select()
      .from(liquidations)
      .where(sql`${liquidations.symbol} = ${symbol} AND ${liquidations.timestamp} >= ${sinceTimestamp}`)
      .orderBy(desc(liquidations.timestamp));
  }

  async saveUserSettings(settings: InsertUserSettings): Promise<UserSettings> {
    // Use INSERT ... ON CONFLICT to upsert settings
    const result = await db.insert(userSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: userSettings.sessionId,
        set: {
          selectedAssets: settings.selectedAssets,
          sideFilter: settings.sideFilter,
          minValue: settings.minValue,
          timeRange: settings.timeRange,
          lastUpdated: sql`now()`,
        }
      })
      .returning();
    return result[0];
  }

  // Trading Strategy operations
  async createStrategy(strategy: InsertStrategy): Promise<Strategy> {
    const result = await db.insert(strategies).values(strategy).returning();
    return result[0];
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    const result = await db.select().from(strategies).where(eq(strategies.id, id));
    return result[0];
  }

  async getStrategiesBySession(sessionId: string): Promise<Strategy[]> {
    return await db.select().from(strategies)
      .where(eq(strategies.sessionId, sessionId))
      .orderBy(desc(strategies.createdAt));
  }

  async getAllActiveStrategies(): Promise<Strategy[]> {
    return await db.select().from(strategies)
      .where(eq(strategies.isActive, true))
      .orderBy(desc(strategies.createdAt));
  }

  async updateStrategy(id: string, updates: Partial<InsertStrategy>): Promise<Strategy> {
    const result = await db.update(strategies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(strategies.id, id))
      .returning();
    return result[0];
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(strategies).where(eq(strategies.id, id));
  }

  // Trade Session operations
  async createTradeSession(session: InsertTradeSession): Promise<TradeSession> {
    const result = await db.insert(tradeSessions).values(session).returning();
    return result[0];
  }

  async getTradeSession(id: string): Promise<TradeSession | undefined> {
    const result = await db.select().from(tradeSessions).where(eq(tradeSessions.id, id));
    return result[0];
  }

  async getActiveTradeSession(strategyId: string): Promise<TradeSession | undefined> {
    const result = await db.select().from(tradeSessions)
      .where(and(eq(tradeSessions.strategyId, strategyId), eq(tradeSessions.isActive, true)))
      .orderBy(desc(tradeSessions.startedAt))
      .limit(1);
    return result[0];
  }

  async updateTradeSession(id: string, updates: Partial<InsertTradeSession>): Promise<TradeSession> {
    const result = await db.update(tradeSessions)
      .set(updates)
      .where(eq(tradeSessions.id, id))
      .returning();
    return result[0];
  }

  async endTradeSession(id: string): Promise<TradeSession> {
    const result = await db.update(tradeSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(eq(tradeSessions.id, id))
      .returning();
    return result[0];
  }

  // Order operations
  async placePaperOrder(order: InsertOrder): Promise<Order> {
    const result = await db.insert(orders).values(order).returning();
    return result[0];
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const result = await db.select().from(orders).where(eq(orders.id, id));
    return result[0];
  }

  async getOrdersBySession(sessionId: string): Promise<Order[]> {
    return await db.select().from(orders)
      .where(eq(orders.sessionId, sessionId))
      .orderBy(desc(orders.createdAt));
  }

  async updateOrderStatus(id: string, status: string, filledAt?: Date): Promise<Order> {
    const updateData: any = { status };
    if (filledAt) updateData.filledAt = filledAt;
    
    const result = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, id))
      .returning();
    return result[0];
  }

  // Fill operations
  async applyFill(fill: InsertFill): Promise<Fill> {
    const result = await db.insert(fills).values(fill).returning();
    return result[0];
  }

  async getFillsBySession(sessionId: string): Promise<Fill[]> {
    return await db.select().from(fills)
      .where(eq(fills.sessionId, sessionId))
      .orderBy(desc(fills.filledAt));
  }

  async getFillsByOrder(orderId: string): Promise<Fill[]> {
    return await db.select().from(fills)
      .where(eq(fills.orderId, orderId))
      .orderBy(desc(fills.filledAt));
  }

  // Position operations
  async createPosition(position: InsertPosition): Promise<Position> {
    const result = await db.insert(positions).values(position).returning();
    return result[0];
  }

  async getPosition(id: string): Promise<Position | undefined> {
    const result = await db.select().from(positions).where(eq(positions.id, id));
    return result[0];
  }

  async getPositionBySymbol(sessionId: string, symbol: string): Promise<Position | undefined> {
    const result = await db.select().from(positions)
      .where(and(
        eq(positions.sessionId, sessionId),
        eq(positions.symbol, symbol),
        eq(positions.isOpen, true)
      ))
      .limit(1);
    return result[0];
  }

  async getOpenPositions(sessionId: string): Promise<Position[]> {
    return await db.select().from(positions)
      .where(and(eq(positions.sessionId, sessionId), eq(positions.isOpen, true)))
      .orderBy(desc(positions.openedAt));
  }

  async updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position> {
    const result = await db.update(positions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    return result[0];
  }

  async closePosition(id: string, closedAt: Date, realizedPnl: number): Promise<Position> {
    const result = await db.update(positions)
      .set({
        isOpen: false,
        closedAt,
        realizedPnl: realizedPnl.toString(),
        updatedAt: new Date()
      })
      .where(eq(positions.id, id))
      .returning();
    return result[0];
  }

  // P&L Snapshot operations
  async createPnlSnapshot(snapshot: InsertPnlSnapshot): Promise<PnlSnapshot> {
    const result = await db.insert(pnlSnapshots).values(snapshot).returning();
    return result[0];
  }

  async getPnlSnapshots(sessionId: string, limit: number = 100): Promise<PnlSnapshot[]> {
    return await db.select().from(pnlSnapshots)
      .where(eq(pnlSnapshots.sessionId, sessionId))
      .orderBy(desc(pnlSnapshots.snapshotAt))
      .limit(limit);
  }

  async getLatestPnlSnapshot(sessionId: string): Promise<PnlSnapshot | undefined> {
    const result = await db.select().from(pnlSnapshots)
      .where(eq(pnlSnapshots.sessionId, sessionId))
      .orderBy(desc(pnlSnapshots.snapshotAt))
      .limit(1);
    return result[0];
  }
}

export const storage = new DatabaseStorage();
