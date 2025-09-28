import { 
  type User, type InsertUser, type Liquidation, type InsertLiquidation, 
  type UserSettings, type InsertUserSettings,
  type RiskSettings, type InsertRiskSettings,
  type TradingStrategy, type InsertTradingStrategy,
  type Portfolio, type InsertPortfolio,
  type Position, type InsertPosition,
  type Trade, type InsertTrade,
  type MarketData, type InsertMarketData,
  type TradingFees, type InsertTradingFees
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { 
  liquidations, users, userSettings, riskSettings,
  tradingStrategies, portfolios, positions, trades, marketData, tradingFees 
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
  
  // Risk settings operations
  getRiskSettings(sessionId: string): Promise<RiskSettings | undefined>;
  saveRiskSettings(settings: InsertRiskSettings): Promise<RiskSettings>;

  // Trading fees operations
  getTradingFees(sessionId: string): Promise<TradingFees | undefined>;
  saveTradingFees(fees: InsertTradingFees): Promise<TradingFees>;

  // Trading strategy operations
  createTradingStrategy(strategy: InsertTradingStrategy): Promise<TradingStrategy>;
  getTradingStrategies(sessionId: string): Promise<TradingStrategy[]>;
  getActiveTradingStrategies(sessionId: string): Promise<TradingStrategy[]>;
  updateTradingStrategy(id: string, updates: Partial<InsertTradingStrategy>): Promise<TradingStrategy>;
  deleteTradingStrategy(id: string): Promise<void>;

  // Portfolio operations
  getOrCreatePortfolio(sessionId: string): Promise<Portfolio>;
  getPortfolioById(id: string): Promise<Portfolio | undefined>;
  getAllPaperTradingPortfolios(): Promise<Portfolio[]>;
  updatePortfolio(id: string, updates: Partial<InsertPortfolio>): Promise<Portfolio>;
  
  // Position operations
  createPosition(position: InsertPosition): Promise<Position>;
  getOpenPositions(portfolioId: string): Promise<Position[]>;
  getOpenPositionsWithLiquidation(portfolioId: string): Promise<(Position & { triggeringLiquidation?: Liquidation })[]>;
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
  
  // Risk settings operations
  async getRiskSettings(sessionId: string): Promise<RiskSettings | undefined> {
    const result = await db.select().from(riskSettings).where(eq(riskSettings.sessionId, sessionId));
    return result[0];
  }
  
  async saveRiskSettings(settings: InsertRiskSettings): Promise<RiskSettings> {
    // Use INSERT ... ON CONFLICT to upsert risk settings
    const result = await db.insert(riskSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: riskSettings.sessionId,
        set: {
          maxPortfolioExposurePercent: settings.maxPortfolioExposurePercent,
          warningPortfolioExposurePercent: settings.warningPortfolioExposurePercent,
          maxSymbolConcentrationPercent: settings.maxSymbolConcentrationPercent,
          maxPositionsPerSymbol: settings.maxPositionsPerSymbol,
          maxPositionSizePercent: settings.maxPositionSizePercent,
          minPositionSize: settings.minPositionSize,
          maxRiskPerTradePercent: settings.maxRiskPerTradePercent,
          highVolatilityThreshold: settings.highVolatilityThreshold,
          extremeVolatilityThreshold: settings.extremeVolatilityThreshold,
          cascadeDetectionEnabled: settings.cascadeDetectionEnabled,
          cascadeCooldownMinutes: settings.cascadeCooldownMinutes,
          lowLiquidationCount: settings.lowLiquidationCount,
          mediumLiquidationCount: settings.mediumLiquidationCount,
          highLiquidationCount: settings.highLiquidationCount,
          extremeLiquidationCount: settings.extremeLiquidationCount,
          lowVelocityPerMinute: settings.lowVelocityPerMinute,
          mediumVelocityPerMinute: settings.mediumVelocityPerMinute,
          highVelocityPerMinute: settings.highVelocityPerMinute,
          extremeVelocityPerMinute: settings.extremeVelocityPerMinute,
          lowVolumeThreshold: settings.lowVolumeThreshold,
          mediumVolumeThreshold: settings.mediumVolumeThreshold,
          highVolumeThreshold: settings.highVolumeThreshold,
          extremeVolumeThreshold: settings.extremeVolumeThreshold,
          cascadeAnalysisWindowMinutes: settings.cascadeAnalysisWindowMinutes,
          systemWideCascadeWindowMinutes: settings.systemWideCascadeWindowMinutes,
          // Global Trading Settings - CRITICAL: Add missing leverage field!
          simulateOnly: settings.simulateOnly,
          maxTotalExposureUsd: settings.maxTotalExposureUsd,
          volumeWindowSec: settings.volumeWindowSec,
          orderTtlSec: settings.orderTtlSec,
          rateLimitBufferPercent: settings.rateLimitBufferPercent,
          timeInForce: settings.timeInForce,
          marginType: settings.marginType,
          leverage: settings.leverage,
          // Default Strategy Settings
          defaultStopLossPercent: settings.defaultStopLossPercent,
          defaultTakeProfitPercent: settings.defaultTakeProfitPercent,
          defaultRiskRewardRatio: settings.defaultRiskRewardRatio,
          // Order Management Settings
          maxOpenOrdersPerSymbol: settings.maxOpenOrdersPerSymbol,
          batchOrders: settings.batchOrders,
          enableOrderConsolidation: settings.enableOrderConsolidation,
          maxStopOrdersPerSymbol: settings.maxStopOrdersPerSymbol,
          orderCleanupIntervalSec: settings.orderCleanupIntervalSec,
          staleLimitOrderMin: settings.staleLimitOrderMin,
          // Advanced Features
          multiAssetsMode: settings.multiAssetsMode,
          hedgeMode: settings.hedgeMode,
          usePositionMonitor: settings.usePositionMonitor,
          useUsdtVolume: settings.useUsdtVolume,
          maxTranchesPerSymbolSide: settings.maxTranchesPerSymbolSide,
          tranchePnlIncrementPercent: settings.tranchePnlIncrementPercent,
          updatedAt: sql`now()`,
        }
      })
      .returning();
    return result[0];
  }

  async getTradingFees(sessionId: string): Promise<TradingFees | undefined> {
    const result = await db.select().from(tradingFees).where(eq(tradingFees.sessionId, sessionId));
    return result[0];
  }

  async saveTradingFees(fees: InsertTradingFees): Promise<TradingFees> {
    // Use INSERT ... ON CONFLICT to upsert trading fees
    const result = await db.insert(tradingFees)
      .values(fees)
      .onConflictDoUpdate({
        target: tradingFees.sessionId,
        set: {
          paperMarketOrderFeePercent: fees.paperMarketOrderFeePercent,
          paperLimitOrderFeePercent: fees.paperLimitOrderFeePercent,
          realMarketOrderFeePercent: fees.realMarketOrderFeePercent,
          realLimitOrderFeePercent: fees.realLimitOrderFeePercent,
          simulateRealisticFees: fees.simulateRealisticFees,
          updatedAt: sql`now()`,
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
    // Remove any timestamp fields from updates to avoid conflicts
    const cleanUpdates = { ...updates };
    delete (cleanUpdates as any).createdAt;
    delete (cleanUpdates as any).updatedAt;
    
    const result = await db.update(tradingStrategies)
      .set({ ...cleanUpdates, updatedAt: sql`now()` })
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

  async getPortfolioById(id: string): Promise<Portfolio | undefined> {
    const result = await db.select().from(portfolios)
      .where(eq(portfolios.id, id));
    return result[0];
  }

  async getAllPaperTradingPortfolios(): Promise<Portfolio[]> {
    return await db.select().from(portfolios)
      .where(eq(portfolios.tradingMode, 'paper'));
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

  async getOpenPositionsWithLiquidation(portfolioId: string): Promise<(Position & { triggeringLiquidation?: Liquidation })[]> {
    const result = await db
      .select({
        // Position fields
        id: positions.id,
        strategyId: positions.strategyId,
        portfolioId: positions.portfolioId,
        symbol: positions.symbol,
        side: positions.side,
        size: positions.size,
        entryPrice: positions.entryPrice,
        currentPrice: positions.currentPrice,
        stopLossPrice: positions.stopLossPrice,
        takeProfitPrice: positions.takeProfitPrice,
        unrealizedPnl: positions.unrealizedPnl,
        tradingMode: positions.tradingMode,
        status: positions.status,
        triggeredByLiquidation: positions.triggeredByLiquidation,
        volatilityAtEntry: positions.volatilityAtEntry,
        createdAt: positions.createdAt,
        updatedAt: positions.updatedAt,
        // Liquidation fields (nullable)
        liquidationId: liquidations.id,
        liquidationSymbol: liquidations.symbol,
        liquidationSide: liquidations.side,
        liquidationSize: liquidations.size,
        liquidationPrice: liquidations.price,
        liquidationValue: liquidations.value,
        liquidationTimestamp: liquidations.timestamp,
      })
      .from(positions)
      .leftJoin(liquidations, eq(positions.triggeredByLiquidation, liquidations.id))
      .where(and(
        eq(positions.portfolioId, portfolioId),
        eq(positions.status, 'open')
      ))
      .orderBy(desc(positions.createdAt));

    return result.map(row => ({
      id: row.id,
      strategyId: row.strategyId,
      portfolioId: row.portfolioId,
      symbol: row.symbol,
      side: row.side,
      size: row.size,
      entryPrice: row.entryPrice,
      currentPrice: row.currentPrice,
      stopLossPrice: row.stopLossPrice,
      takeProfitPrice: row.takeProfitPrice,
      unrealizedPnl: row.unrealizedPnl,
      tradingMode: row.tradingMode,
      status: row.status,
      triggeredByLiquidation: row.triggeredByLiquidation,
      volatilityAtEntry: row.volatilityAtEntry,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      triggeringLiquidation: row.liquidationId ? {
        id: row.liquidationId,
        symbol: row.liquidationSymbol!,
        side: row.liquidationSide!,
        size: row.liquidationSize!,
        price: row.liquidationPrice!,
        value: row.liquidationValue!,
        timestamp: row.liquidationTimestamp!,
      } : undefined,
    }));
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

  async updateUnrealizedPnl(portfolioId: string): Promise<Position[]> {
    try {
      // Get all open positions for this portfolio
      const openPositions = await this.getOpenPositions(portfolioId);
      
      if (openPositions.length === 0) {
        return [];
      }
      
      // Get unique symbols from open positions
      const symbols = Array.from(new Set(openPositions.map(pos => pos.symbol)));
      
      // Fetch current prices for all symbols
      const pricePromises = symbols.map(async (symbol) => {
        try {
          const klinesResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1`, {
            headers: {
              'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
            }
          });
          
          if (klinesResponse.ok) {
            const klinesData = await klinesResponse.json();
            if (klinesData.length > 0) {
              const latestKline = klinesData[0];
              return {
                symbol,
                price: parseFloat(latestKline[4]) // Close price
              };
            }
          }
          return null;
        } catch (error) {
          console.error(`Error fetching price for ${symbol}:`, error);
          return null;
        }
      });
      
      const priceResults = await Promise.all(pricePromises);
      const priceMap = new Map<string, number>();
      
      priceResults.forEach(result => {
        if (result) {
          priceMap.set(result.symbol, result.price);
        }
      });
      
      // Update positions with current prices and calculated unrealized PNL
      const updatePromises = openPositions.map(async (position) => {
        const currentPrice = priceMap.get(position.symbol);
        
        if (!currentPrice) {
          // If we can't get current price, return position unchanged
          return position;
        }
        
        const entryPrice = parseFloat(position.entryPrice);
        const size = parseFloat(position.size);
        
        // Calculate unrealized PnL based on position side
        let unrealizedPnl = 0;
        if (position.side === 'long') {
          unrealizedPnl = (currentPrice - entryPrice) * size;
        } else {
          unrealizedPnl = (entryPrice - currentPrice) * size;
        }
        
        // Update the position in database
        const updatedPosition = await this.updatePosition(position.id, {
          currentPrice: currentPrice.toString(),
          unrealizedPnl: unrealizedPnl.toString()
        });
        
        return updatedPosition;
      });
      
      const updatedPositions = await Promise.all(updatePromises);
      console.log(`📊 Updated unrealized PNL for ${updatedPositions.length} positions`);
      
      return updatedPositions;
    } catch (error) {
      console.error('Error updating unrealized PNL:', error);
      // Return original positions if update fails
      return await this.getOpenPositions(portfolioId);
    }
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
