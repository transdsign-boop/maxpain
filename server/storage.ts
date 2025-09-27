import { 
  type User, type InsertUser, type Liquidation, type InsertLiquidation, 
  type UserSettings, type InsertUserSettings,
  type TradingStrategy, type InsertTradingStrategy,
  type Portfolio, type InsertPortfolio,
  type Position, type InsertPosition,
  type Trade, type InsertTrade,
  type MarketData, type InsertMarketData
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { 
  liquidations, users, userSettings, 
  tradingStrategies, portfolios, positions, trades, marketData 
} from "@shared/schema";
import { desc, gte, eq, sql, and, or } from "drizzle-orm";

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
  
  // Analytics operations
  getAvailableAssets(): Promise<{ symbol: string; count: number; latestTimestamp: Date }[]>;
  getLiquidationAnalytics(symbol: string, sinceTimestamp: Date): Promise<Liquidation[]>;
  
  // User settings operations
  getUserSettings(sessionId: string): Promise<UserSettings | undefined>;
  saveUserSettings(settings: InsertUserSettings): Promise<UserSettings>;

  // Trading strategy operations
  createTradingStrategy(strategy: InsertTradingStrategy): Promise<TradingStrategy>;
  getTradingStrategies(sessionId: string): Promise<TradingStrategy[]>;
  getActiveTradingStrategies(sessionId: string): Promise<TradingStrategy[]>;
  updateTradingStrategy(id: string, updates: Partial<InsertTradingStrategy>): Promise<TradingStrategy>;
  deleteTradingStrategy(id: string): Promise<void>;

  // Portfolio operations
  getOrCreatePortfolio(sessionId: string): Promise<Portfolio>;
  updatePortfolio(id: string, updates: Partial<InsertPortfolio>): Promise<Portfolio>;
  
  // Position operations
  createPosition(position: InsertPosition): Promise<Position>;
  getOpenPositions(portfolioId: string): Promise<Position[]>;
  getOpenPositionsBySymbol(portfolioId: string, symbol: string): Promise<Position[]>;
  updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position>;
  closePosition(id: string, exitPrice: string, exitReason: string): Promise<Trade>;
  
  // Trade operations
  getTrades(portfolioId: string, limit?: number): Promise<Trade[]>;
  getTradesByStrategy(strategyId: string, limit?: number): Promise<Trade[]>;
  
  // Market data operations
  updateMarketData(data: InsertMarketData): Promise<MarketData>;
  getLatestMarketData(symbol: string): Promise<MarketData | undefined>;
  calculateVolatility(symbol: string, hours: number): Promise<number>;
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
    
    // Use OR conditions for multiple symbols
    if (symbols.length === 1) {
      return await db.select()
        .from(liquidations)
        .where(eq(liquidations.symbol, symbols[0]))
        .orderBy(desc(liquidations.timestamp))
        .limit(limit);
    }
    
    // For multiple symbols, use inArray
    return await db.select()
      .from(liquidations)
      .where(sql`${liquidations.symbol} = ANY(${symbols})`)
      .orderBy(desc(liquidations.timestamp))
      .limit(limit);
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

  // Trading strategy operations
  async createTradingStrategy(strategy: InsertTradingStrategy): Promise<TradingStrategy> {
    const result = await db.insert(tradingStrategies).values(strategy).returning();
    return result[0];
  }

  async getTradingStrategies(sessionId: string): Promise<TradingStrategy[]> {
    return await db.select().from(tradingStrategies)
      .where(eq(tradingStrategies.sessionId, sessionId))
      .orderBy(desc(tradingStrategies.createdAt));
  }

  async getActiveTradingStrategies(sessionId: string): Promise<TradingStrategy[]> {
    return await db.select().from(tradingStrategies)
      .where(and(
        eq(tradingStrategies.sessionId, sessionId),
        eq(tradingStrategies.isActive, true)
      ))
      .orderBy(desc(tradingStrategies.createdAt));
  }

  async updateTradingStrategy(id: string, updates: Partial<InsertTradingStrategy>): Promise<TradingStrategy> {
    const result = await db.update(tradingStrategies)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(tradingStrategies.id, id))
      .returning();
    return result[0];
  }

  async deleteTradingStrategy(id: string): Promise<void> {
    await db.delete(tradingStrategies).where(eq(tradingStrategies.id, id));
  }

  // Portfolio operations
  async getOrCreatePortfolio(sessionId: string): Promise<Portfolio> {
    const existing = await db.select().from(portfolios)
      .where(eq(portfolios.sessionId, sessionId));
    
    if (existing.length > 0) {
      return existing[0];
    }

    const result = await db.insert(portfolios)
      .values({ sessionId })
      .returning();
    return result[0];
  }

  async updatePortfolio(id: string, updates: Partial<InsertPortfolio>): Promise<Portfolio> {
    const result = await db.update(portfolios)
      .set({ ...updates, lastUpdated: sql`now()` })
      .where(eq(portfolios.id, id))
      .returning();
    return result[0];
  }

  // Position operations
  async createPosition(position: InsertPosition): Promise<Position> {
    const result = await db.insert(positions).values(position).returning();
    return result[0];
  }

  async getOpenPositions(portfolioId: string): Promise<Position[]> {
    return await db.select().from(positions)
      .where(and(
        eq(positions.portfolioId, portfolioId),
        eq(positions.status, 'open')
      ))
      .orderBy(desc(positions.createdAt));
  }

  async getOpenPositionsBySymbol(portfolioId: string, symbol: string): Promise<Position[]> {
    return await db.select().from(positions)
      .where(and(
        eq(positions.portfolioId, portfolioId),
        eq(positions.symbol, symbol),
        eq(positions.status, 'open')
      ))
      .orderBy(desc(positions.createdAt));
  }

  async updatePosition(id: string, updates: Partial<InsertPosition>): Promise<Position> {
    const result = await db.update(positions)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(positions.id, id))
      .returning();
    return result[0];
  }

  async closePosition(id: string, exitPrice: string, exitReason: string): Promise<Trade> {
    // Get the position details
    const position = await db.select().from(positions).where(eq(positions.id, id));
    if (!position[0]) {
      throw new Error('Position not found');
    }

    const pos = position[0];
    const entryPrice = parseFloat(pos.entryPrice);
    const exit = parseFloat(exitPrice);
    const size = parseFloat(pos.size);
    
    // Calculate PnL
    let realizedPnl = 0;
    if (pos.side === 'long') {
      realizedPnl = (exit - entryPrice) * size;
    } else {
      realizedPnl = (entryPrice - exit) * size;
    }

    // Calculate duration
    const duration = Math.floor((Date.now() - new Date(pos.createdAt).getTime()) / 1000);

    // Create trade record
    const tradeResult = await db.insert(trades).values({
      positionId: id,
      strategyId: pos.strategyId,
      portfolioId: pos.portfolioId,
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      exitPrice: exitPrice,
      realizedPnl: realizedPnl.toString(),
      tradingMode: pos.tradingMode,
      exitReason,
      triggeredByLiquidation: pos.triggeredByLiquidation,
      duration,
      volatilityAtEntry: pos.volatilityAtEntry
    }).returning();

    // Update position status
    await db.update(positions)
      .set({ status: 'closed', updatedAt: sql`now()` })
      .where(eq(positions.id, id));

    return tradeResult[0];
  }

  // Trade operations
  async getTrades(portfolioId: string, limit: number = 100): Promise<Trade[]> {
    return await db.select().from(trades)
      .where(eq(trades.portfolioId, portfolioId))
      .orderBy(desc(trades.closedAt))
      .limit(limit);
  }

  async getTradesByStrategy(strategyId: string, limit: number = 100): Promise<Trade[]> {
    return await db.select().from(trades)
      .where(eq(trades.strategyId, strategyId))
      .orderBy(desc(trades.closedAt))
      .limit(limit);
  }

  // Market data operations
  async updateMarketData(data: InsertMarketData): Promise<MarketData> {
    const result = await db.insert(marketData)
      .values(data)
      .onConflictDoUpdate({
        target: marketData.symbol,
        set: {
          price: data.price,
          volume: data.volume,
          volatility24h: data.volatility24h,
          volatility1h: data.volatility1h,
          liquidationPressure: data.liquidationPressure,
          cascadeRisk: data.cascadeRisk,
          timestamp: sql`now()`
        }
      })
      .returning();
    return result[0];
  }

  async getLatestMarketData(symbol: string): Promise<MarketData | undefined> {
    const result = await db.select().from(marketData)
      .where(eq(marketData.symbol, symbol))
      .orderBy(desc(marketData.timestamp))
      .limit(1);
    return result[0];
  }

  async calculateVolatility(symbol: string, hours: number): Promise<number> {
    const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const liquidationData = await db.select()
      .from(liquidations)
      .where(and(
        eq(liquidations.symbol, symbol),
        gte(liquidations.timestamp, sinceTimestamp)
      ))
      .orderBy(liquidations.timestamp);

    if (liquidationData.length < 2) return 0;

    // Calculate price volatility from liquidation prices
    const prices = liquidationData.map(l => parseFloat(l.price));
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;
    const volatility = (Math.sqrt(variance) / mean) * 100;

    return volatility;
  }
}

export const storage = new DatabaseStorage();
