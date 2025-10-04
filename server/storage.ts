import { 
  type User, type UpsertUser, type Liquidation, type InsertLiquidation, 
  type UserSettings, type InsertUserSettings,
  type Strategy, type InsertStrategy,
  type TradeSession, type InsertTradeSession,
  type Order, type InsertOrder,
  type Fill, type InsertFill,
  type Position, type InsertPosition,
  type PnlSnapshot, type InsertPnlSnapshot,
  type StrategyChange, type InsertStrategyChange
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { liquidations, users, userSettings, strategies, tradeSessions, orders, fills, positions, pnlSnapshots, strategyChanges } from "@shared/schema";
import { desc, gte, eq, sql, inArray, and } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // Replit Auth user operations (IMPORTANT - mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Liquidation operations
  insertLiquidation(liquidation: InsertLiquidation): Promise<Liquidation>;
  getLiquidations(limit?: number): Promise<Liquidation[]>;
  getLiquidationsBySymbol(symbols: string[], limit?: number): Promise<Liquidation[]>;
  getLiquidationsSince(timestamp: Date, limit?: number): Promise<Liquidation[]>;
  getLargestLiquidationSince(timestamp: Date): Promise<Liquidation | undefined>;
  getLiquidationsBySignature(symbol: string, side: string, size: string, price: string, since: Date): Promise<Liquidation[]>;
  getLiquidationsByEventTimestamp(eventTimestamp: string): Promise<Liquidation[]>;
  deleteOldLiquidations(olderThanDays: number): Promise<number>;
  
  // Analytics operations
  getAvailableAssets(): Promise<{ symbol: string; count: number; latestTimestamp: Date }[]>;
  getLiquidationAnalytics(symbol: string, sinceTimestamp: Date): Promise<Liquidation[]>;
  getAssetPerformance(): Promise<{ symbol: string; wins: number; losses: number; winRate: number; totalPnl: number; totalTrades: number }[]>;
  
  // User settings operations
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  saveUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  // Trading Strategy operations
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  getStrategiesByUser(userId: string): Promise<Strategy[]>;
  getAllActiveStrategies(): Promise<Strategy[]>;
  updateStrategy(id: string, updates: Partial<InsertStrategy>): Promise<Strategy>;
  deleteStrategy(id: string): Promise<void>;
  
  // Singleton strategy and session
  getOrCreateDefaultStrategy(userId: string): Promise<Strategy>;
  getOrCreateActiveSession(userId: string): Promise<TradeSession>;
  updateSessionBalance(sessionId: string, newBalance: number): Promise<TradeSession>;

  // Trade Session operations
  createTradeSession(session: InsertTradeSession): Promise<TradeSession>;
  getTradeSession(id: string): Promise<TradeSession | undefined>;
  getActiveTradeSession(strategyId: string): Promise<TradeSession | undefined>;
  getSessionsByStrategy(strategyId: string): Promise<TradeSession[]>;
  getAllTradeSessions(userId: string): Promise<TradeSession[]>;
  updateTradeSession(id: string, updates: Partial<InsertTradeSession>): Promise<TradeSession>;
  endTradeSession(id: string): Promise<TradeSession>;

  // Order operations
  placePaperOrder(order: InsertOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrdersBySession(sessionId: string): Promise<Order[]>;
  updateOrderStatus(id: string, status: string, filledAt?: Date, price?: string): Promise<Order>;

  // Fill operations
  applyFill(fill: InsertFill): Promise<Fill>;
  getFillsBySession(sessionId: string): Promise<Fill[]>;
  getFillsByOrder(orderId: string): Promise<Fill[]>;
  getRecentFills(symbol: string, since: Date): Promise<Fill[]>;
  clearFillsBySession(sessionId: string): Promise<void>;

  // Position operations
  createPosition(position: InsertPosition): Promise<Position>;
  getPosition(id: string): Promise<Position | undefined>;
  getPositionBySymbol(sessionId: string, symbol: string): Promise<Position | undefined>;
  getPositionBySymbolAndSide(sessionId: string, symbol: string, side: string): Promise<Position | undefined>;
  getOpenPositions(sessionId: string): Promise<Position[]>;
  getClosedPositions(sessionId: string): Promise<Position[]>;
  getPositionsBySession(sessionId: string): Promise<Position[]>;
  updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position>;
  closePosition(id: string, closedAt: Date, realizedPnl: number, realizedPnlPercent?: number): Promise<Position>;
  clearPositionsBySession(sessionId: string): Promise<void>;

  // P&L Snapshot operations
  createPnlSnapshot(snapshot: InsertPnlSnapshot): Promise<PnlSnapshot>;
  getPnlSnapshots(sessionId: string, limit?: number): Promise<PnlSnapshot[]>;
  getLatestPnlSnapshot(sessionId: string): Promise<PnlSnapshot | undefined>;

  // Strategy Change operations
  recordStrategyChange(change: InsertStrategyChange): Promise<StrategyChange>;
  getStrategyChanges(sessionId: string): Promise<StrategyChange[]>;
  getStrategyChangesByStrategy(strategyId: string): Promise<StrategyChange[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
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

  async getLiquidationsByEventTimestamp(eventTimestamp: string): Promise<Liquidation[]> {
    return await db.select()
      .from(liquidations)
      .where(eq(liquidations.eventTimestamp, eventTimestamp))
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

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const result = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return result[0];
  }

  async getAvailableAssets(): Promise<{ symbol: string; count: number; latestTimestamp: Date }[]> {
    // Only return data from last 5 days
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    
    const result = await db.select({
      symbol: liquidations.symbol,
      count: sql<number>`COUNT(*)`,
      latestTimestamp: sql<Date>`MAX(${liquidations.timestamp})`
    })
    .from(liquidations)
    .where(gte(liquidations.timestamp, fiveDaysAgo))
    .groupBy(liquidations.symbol)
    .orderBy(desc(sql`COUNT(*)`)); // Sort by liquidation count descending
    
    return result;
  }

  async getAssetPerformance(): Promise<{ symbol: string; wins: number; losses: number; winRate: number; totalPnl: number; totalTrades: number }[]> {
    const result = await db.select({
      symbol: positions.symbol,
      wins: sql<number>`COUNT(CASE WHEN ${positions.isOpen} = false AND ${positions.realizedPnl} > 0 THEN 1 END)`,
      losses: sql<number>`COUNT(CASE WHEN ${positions.isOpen} = false AND ${positions.realizedPnl} < 0 THEN 1 END)`,
      totalPnl: sql<number>`COALESCE(SUM(CASE WHEN ${positions.isOpen} = false THEN ${positions.realizedPnl} ELSE 0 END), 0)`,
      totalTrades: sql<number>`COUNT(CASE WHEN ${positions.isOpen} = false THEN 1 END)`,
    })
    .from(positions)
    .groupBy(positions.symbol)
    .having(sql`COUNT(CASE WHEN ${positions.isOpen} = false THEN 1 END) > 0`);
    
    return result.map(r => {
      const wins = parseInt(String(r.wins));
      const losses = parseInt(String(r.losses));
      const total = wins + losses;
      const totalPnl = parseFloat(String(r.totalPnl));
      return {
        symbol: r.symbol,
        wins,
        losses,
        totalPnl,
        totalTrades: parseInt(String(r.totalTrades)),
        winRate: total > 0 ? (wins / total) * 100 : 0
      };
    });
  }

  async deleteOldLiquidations(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const result = await db.delete(liquidations)
      .where(sql`${liquidations.timestamp} < ${cutoffDate}`)
      .returning({ id: liquidations.id });
    
    return result.length;
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
        target: userSettings.userId,
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

  async getStrategiesByUser(userId: string): Promise<Strategy[]> {
    return await db.select().from(strategies)
      .where(eq(strategies.userId, userId))
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

  // Singleton strategy and session operations
  async getOrCreateDefaultStrategy(userId: string): Promise<Strategy> {
    // Try to get existing active strategy for this user
    const existing = await db.select().from(strategies)
      .where(and(eq(strategies.userId, userId), eq(strategies.isActive, true)))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }

    // Create default strategy if doesn't exist
    const defaultStrategy: InsertStrategy = {
      userId,
      name: "Liquidation Counter-Trade",
      selectedAssets: ["BTCUSDT"],
      isActive: true,
      tradingMode: "paper",
      positionSizePercent: "10.00",
      percentileThreshold: 90,
      liquidationLookbackHours: 1,
      stopLossPercent: "2.00",
      profitTargetPercent: "3.00",
      maxLayers: 5,
      orderDelayMs: 1000,
      orderType: "market",
      maxRetryDurationMs: 30000,
      slippageTolerancePercent: "0.50"
    };

    const result = await db.insert(strategies).values(defaultStrategy).returning();
    const newStrategy = result[0];
    
    // Initialize DCA parameters using SQL wrapper (bypasses Drizzle cache)
    const { updateStrategyDCAParams } = await import('./dca-sql');
    await updateStrategyDCAParams(newStrategy.id, {
      dcaStartStepPercent: "0.4",      // First DCA at 0.4% from entry
      dcaSpacingConvexity: "1.2",      // Convex spacing
      dcaSizeGrowth: "1.8",            // Each level 1.8x larger
      dcaMaxRiskPercent: "1.0",        // Max 1% account risk
      dcaVolatilityRef: "1.0",         // Volatility reference
      dcaExitCushionMultiplier: "0.6"  // Exit at 60% of DCA distance
    });
    
    return newStrategy;
  }

  async getOrCreateActiveSession(userId: string): Promise<TradeSession> {
    // Get the user's default strategy
    const strategy = await this.getOrCreateDefaultStrategy(userId);

    // Try to get existing active session for this strategy
    const existing = await db.select().from(tradeSessions)
      .where(and(eq(tradeSessions.strategyId, strategy.id), eq(tradeSessions.isActive, true)))
      .limit(1);
    
    if (existing.length > 0) {
      const session = existing[0];
      
      // Auto-sync balance if it's zero or very small (< $1)
      const currentBalance = parseFloat(session.currentBalance);
      if (currentBalance < 1) {
        console.log('⚠️ Session balance is zero or very low, auto-syncing with exchange balance...');
        const exchangeBalance = await this.getExchangeBalance();
        if (exchangeBalance && parseFloat(exchangeBalance) > 0) {
          const synced = await this.updateSessionBalance(session.id, parseFloat(exchangeBalance));
          console.log(`💰 Auto-synced session balance to $${exchangeBalance}`);
          return synced;
        }
      }
      
      return session;
    }

    // Get real exchange balance for both paper and live trading
    const exchangeBalance = await this.getExchangeBalance();
    const initialBalance = exchangeBalance || "10000.00"; // Fallback to $10k if API unavailable

    // Create new session if doesn't exist
    const newSession: InsertTradeSession = {
      strategyId: strategy.id,
      mode: strategy.tradingMode,
      startingBalance: initialBalance,
      currentBalance: initialBalance,
      isActive: true
    };

    const result = await db.insert(tradeSessions).values(newSession).returning();
    return result[0];
  }

  // Fetch available balance from Aster DEX exchange
  private async getExchangeBalance(): Promise<string | null> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        console.log('ℹ️ Aster DEX API keys not configured, using default balance');
        return null;
      }

      const { createHmac } = await import('crypto');
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/account?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!response.ok) {
        console.log('ℹ️ Could not fetch exchange balance, using default');
        return null;
      }

      const data = await response.json();
      
      // Check for USDT balance first (most common), then USDC, then fall back to top-level balance
      const usdtAsset = data.assets?.find((asset: any) => asset.asset === 'USDT');
      const usdtBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : 0;
      
      const usdcAsset = data.assets?.find((asset: any) => asset.asset === 'USDC');
      const usdcBalance = usdcAsset ? parseFloat(usdcAsset.walletBalance) : 0;
      
      const balance = usdtBalance || usdcBalance || parseFloat(data.availableBalance || '0');
      
      return balance > 0 ? balance.toString() : null;
    } catch (error) {
      console.log('ℹ️ Error fetching exchange balance, using default:', error);
      return null;
    }
  }

  async updateSessionBalance(sessionId: string, newBalance: number): Promise<TradeSession> {
    const result = await db.update(tradeSessions)
      .set({ 
        startingBalance: newBalance.toString(),
        currentBalance: newBalance.toString()
      })
      .where(eq(tradeSessions.id, sessionId))
      .returning();
    return result[0];
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

  async getSessionsByStrategy(strategyId: string): Promise<TradeSession[]> {
    return await db.select().from(tradeSessions)
      .where(eq(tradeSessions.strategyId, strategyId))
      .orderBy(desc(tradeSessions.startedAt));
  }

  async getAllTradeSessions(userId: string): Promise<TradeSession[]> {
    // Get all strategies for this user first
    const userStrategies = await db.select().from(strategies)
      .where(eq(strategies.userId, userId));
    
    if (userStrategies.length === 0) return [];
    
    const strategyIds = userStrategies.map(s => s.id);
    
    // Get all trade sessions for these strategies
    return await db.select().from(tradeSessions)
      .where(sql`${tradeSessions.strategyId} IN (${sql.join(strategyIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(tradeSessions.startedAt));
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

  async updateOrderStatus(id: string, status: string, filledAt?: Date, price?: string): Promise<Order> {
    const updateData: any = { status };
    if (filledAt) updateData.filledAt = filledAt;
    if (price) updateData.price = price;
    
    const result = await db.update(orders)
      .set(updateData)
      .where(eq(orders.id, id))
      .returning();
    return result[0];
  }

  // Fill operations
  async applyFill(fill: InsertFill): Promise<Fill> {
    // Idempotency via database unique constraint on (orderId, sessionId)
    // If a duplicate is attempted, the database will reject it
    try {
      const result = await db.insert(fills).values(fill).returning();
      console.log(`✅ Fill recorded: orderId=${fill.orderId}, qty=${fill.quantity}, price=${fill.price}`);
      return result[0];
    } catch (error: any) {
      // Check if it's a unique constraint violation (duplicate)
      if (error.code === '23505') {
        console.log(`⏭️ Skipping duplicate fill (DB constraint): orderId=${fill.orderId}`);
        // Fetch and return the existing fill
        const existing = await db.select().from(fills)
          .where(eq(fills.orderId, fill.orderId))
          .limit(1);
        return existing[0];
      }
      // Re-throw other errors
      throw error;
    }
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

  async getRecentFills(symbol: string, since: Date): Promise<Fill[]> {
    return await db.select().from(fills)
      .where(and(
        eq(fills.symbol, symbol),
        gte(fills.filledAt, since)
      ))
      .orderBy(desc(fills.filledAt));
  }

  async clearFillsBySession(sessionId: string): Promise<void> {
    await db.delete(fills).where(eq(fills.sessionId, sessionId));
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

  async getPositionBySymbolAndSide(sessionId: string, symbol: string, side: string): Promise<Position | undefined> {
    const result = await db.select().from(positions)
      .where(and(
        eq(positions.sessionId, sessionId),
        eq(positions.symbol, symbol),
        eq(positions.side, side),
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

  async getClosedPositions(sessionId: string): Promise<Position[]> {
    return await db.select().from(positions)
      .where(and(eq(positions.sessionId, sessionId), eq(positions.isOpen, false)))
      .orderBy(desc(positions.closedAt));
  }

  async getPositionsBySession(sessionId: string): Promise<Position[]> {
    return await db.select().from(positions)
      .where(eq(positions.sessionId, sessionId))
      .orderBy(desc(positions.openedAt));
  }

  async updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position> {
    const result = await db.update(positions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    return result[0];
  }

  async closePosition(id: string, closedAt: Date, realizedPnl: number, realizedPnlPercent?: number): Promise<Position> {
    const updates: any = {
      isOpen: false,
      closedAt,
      realizedPnl: realizedPnl.toString(),
      updatedAt: new Date()
    };
    
    // Preserve the percentage P&L at close time in unrealizedPnl field for display
    if (realizedPnlPercent !== undefined) {
      updates.unrealizedPnl = realizedPnlPercent.toString();
    }
    
    const result = await db.update(positions)
      .set(updates)
      .where(eq(positions.id, id))
      .returning();
    return result[0];
  }

  async clearPositionsBySession(sessionId: string): Promise<void> {
    await db.delete(positions).where(eq(positions.sessionId, sessionId));
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

  // Strategy Change operations
  async recordStrategyChange(change: InsertStrategyChange): Promise<StrategyChange> {
    const result = await db.insert(strategyChanges).values(change).returning();
    return result[0];
  }

  async getStrategyChanges(sessionId: string): Promise<StrategyChange[]> {
    return await db.select().from(strategyChanges)
      .where(eq(strategyChanges.sessionId, sessionId))
      .orderBy(desc(strategyChanges.changedAt));
  }

  async getStrategyChangesByStrategy(strategyId: string): Promise<StrategyChange[]> {
    return await db.select().from(strategyChanges)
      .where(eq(strategyChanges.strategyId, strategyId))
      .orderBy(desc(strategyChanges.changedAt));
  }
}

export const storage = new DatabaseStorage();
