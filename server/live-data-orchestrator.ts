import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies, tradeSessions } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { 
  IExchangeStream, 
  NormalizedAccountUpdate, 
  NormalizedOrderUpdate, 
  NormalizedTradeUpdate 
} from './exchanges/types';

interface LiveSnapshot {
  account: {
    feeTier: number;
    canTrade: boolean;
    canDeposit: boolean;
    canWithdraw: boolean;
    updateTime: number;
    totalWalletBalance?: string;
    totalUnrealizedProfit?: string;
    totalMarginBalance?: string;
    totalInitialMargin?: string;
    availableBalance?: string;
    usdcBalance: string;
    usdtBalance: string;
    assets: Array<{
      a: string;
      wb: string;
      cw: string;
      bc: string;
    }>;
  } | null;
  positions: any[];
  positionsSummary: {
    totalExposure: number;
    totalPnl: number;
    unrealizedPnl: number;
    realizedPnl: number;
    currentBalance: number;
    startingBalance: number;
    filledRiskDollars: number;
    filledRiskPercentage: number;
    reservedRiskDollars: number;
    reservedRiskPercentage: number;
  } | null;
  timestamp: number;
  error: string | null;
}

class LiveDataOrchestrator {
  private cache: Map<string, LiveSnapshot> = new Map();
  private lastAccountLogTime: number = 0;
  private lastPositionsLogTime: number = 0;
  private exchangeStreams: Map<string, IExchangeStream> = new Map();

  constructor() {
    console.log('🎯 Live Data Orchestrator initialized - 100% WebSocket mode (NO POLLING)');
  }

  /**
   * Connect to an exchange stream for a strategy
   * This replaces the old user-data-stream integration
   */
  async connectExchangeStream(strategyId: string, stream: IExchangeStream): Promise<void> {
    console.log(`🔌 Connecting exchange stream for strategy ${strategyId} (${stream.exchangeType})`);
    
    // Disconnect existing stream if any
    if (this.exchangeStreams.has(strategyId)) {
      await this.disconnectExchangeStream(strategyId);
    }

    // Store stream reference
    this.exchangeStreams.set(strategyId, stream);

    // Subscribe to stream events
    stream.onAccountUpdate((update: NormalizedAccountUpdate) => {
      this.handleNormalizedAccountUpdate(strategyId, update);
    });

    stream.onOrderUpdate((update: NormalizedOrderUpdate) => {
      this.handleNormalizedOrderUpdate(strategyId, update);
    });

    stream.onTradeUpdate((update: NormalizedTradeUpdate) => {
      this.handleNormalizedTradeUpdate(strategyId, update);
    });

    stream.onError((error: Error) => {
      console.error(`❌ Exchange stream error for strategy ${strategyId}:`, error);
    });

    stream.onDisconnect(() => {
      console.log(`🔌 Exchange stream disconnected for strategy ${strategyId}`);
    });

    stream.onReconnect(() => {
      console.log(`🔄 Exchange stream reconnected for strategy ${strategyId}`);
    });

    // Connect the stream
    await stream.connect();
    console.log(`✅ Exchange stream connected for strategy ${strategyId}`);
  }

  /**
   * Disconnect exchange stream for a strategy
   */
  async disconnectExchangeStream(strategyId: string): Promise<void> {
    const stream = this.exchangeStreams.get(strategyId);
    if (stream) {
      console.log(`🔌 Disconnecting exchange stream for strategy ${strategyId}`);
      
      // Disconnect the stream
      await stream.disconnect();
      
      // Remove from orchestrator's tracking
      this.exchangeStreams.delete(strategyId);
      
      // CRITICAL: Also notify registry to clear cached stream to prevent listener duplication
      // Registry will remove the cached instance, forcing fresh stream on next connect
      const { exchangeRegistry } = await import('./exchanges/registry');
      await exchangeRegistry.disconnectStrategy(strategyId);
    }
  }

  /**
   * Handle normalized account update from exchange stream
   */
  private handleNormalizedAccountUpdate(strategyId: string, update: NormalizedAccountUpdate): void {
    const snapshot = this.getSnapshot(strategyId);
    
    // Process ALL assets (multi-asset collateral support)
    if (update.balances && update.balances.length > 0) {
      // Calculate total wallet balance across all collateral assets
      // (balances are already in USD value from exchange)
      const totalWalletBalance = update.balances.reduce((sum, b) => {
        return sum + parseFloat(b.walletBalance || '0');
      }, 0);
      
      const totalAvailableBalance = update.balances.reduce((sum, b) => {
        return sum + parseFloat(b.crossWalletBalance || '0');
      }, 0);
      
      // Find USDT balance for backward compatibility
      const usdtBalance = update.balances.find(b => b.asset === 'USDT');
      const usdtWalletBalance = usdtBalance?.walletBalance || '0';
      
      // Map all assets to the format expected by frontend
      const assets = update.balances.map(b => ({
        a: b.asset,
        wb: b.walletBalance || '0',
        cw: b.crossWalletBalance || '0',
        bc: '0' // Balance change not provided by exchange
      }));
      
      snapshot.account = {
        feeTier: 0,
        canTrade: true,
        canDeposit: true,
        canWithdraw: true,
        updateTime: Date.now(),
        totalWalletBalance: totalWalletBalance.toString(),
        totalUnrealizedProfit: '0', // Calculated from positions
        totalMarginBalance: totalWalletBalance.toString(),
        totalInitialMargin: '0',
        availableBalance: totalAvailableBalance.toString(),
        usdcBalance: usdtWalletBalance, // Backward compatibility
        usdtBalance: usdtWalletBalance, // Backward compatibility
        assets: assets // All collateral assets
      };
      
      snapshot.timestamp = Date.now();
      
      if (Date.now() - this.lastAccountLogTime > 30000) {
        const assetSummary = update.balances
          .filter(b => parseFloat(b.walletBalance || '0') > 0)
          .map(b => `${b.asset}=$${parseFloat(b.walletBalance || '0').toFixed(2)}`)
          .join(', ');
        console.log(`✅ Account updated from ${this.exchangeStreams.get(strategyId)?.exchangeType} stream (total: $${totalWalletBalance.toFixed(2)}, assets: ${assetSummary})`);
        this.lastAccountLogTime = Date.now();
      }
      
      this.broadcastSnapshot(strategyId);
    }

    // Update positions from normalized account update
    // CRITICAL: Always update positions, even if empty (clears stale data)
    if (update.positions.length > 0) {
      // Convert normalized positions to legacy format
      snapshot.positions = update.positions.map(p => ({
        symbol: p.symbol,
        positionAmt: p.side === 'LONG' ? p.size : `-${p.size}`,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unRealizedProfit: p.unrealizedPnl,
        unrealizedProfit: p.unrealizedPnl,
        marginType: p.marginType === 'CROSSED' ? 'cross' : 'isolated',
        isolatedWallet: '0',
        positionSide: p.positionSide,
        leverage: p.leverage
      }));
    } else {
      // Clear positions when update reports zero positions
      snapshot.positions = [];
      snapshot.positionsSummary = null;
    }
    
    snapshot.timestamp = Date.now();
    
    if (Date.now() - this.lastPositionsLogTime > 30000) {
      console.log(`✅ Positions updated from ${this.exchangeStreams.get(strategyId)?.exchangeType} stream (${update.positions.length} positions)`);
      this.lastPositionsLogTime = Date.now();
    }
    
    this.calculatePositionSummary(strategyId);
  }

  /**
   * Handle normalized order update from exchange stream
   */
  private handleNormalizedOrderUpdate(strategyId: string, update: NormalizedOrderUpdate): void {
    // Broadcast order update to frontend
    wsBroadcaster.broadcast({
      type: 'order_update',
      data: update,
      timestamp: Date.now()
    });
  }

  /**
   * Handle normalized trade update from exchange stream
   */
  private handleNormalizedTradeUpdate(strategyId: string, update: NormalizedTradeUpdate): void {
    // Broadcast trade as order update to frontend (trade is a type of order event)
    wsBroadcaster.broadcast({
      type: 'order_update',
      data: update,
      timestamp: Date.now()
    });

    // Trigger protective order update if configured
    // This will be handled by strategy-engine callbacks
  }

  // Get current snapshot from cache (or create empty one)
  getSnapshot(strategyId: string): LiveSnapshot {
    if (!this.cache.has(strategyId)) {
      this.cache.set(strategyId, {
        account: null,
        positions: [],
        positionsSummary: null,
        timestamp: Date.now(),
        error: null
      });
    }
    return this.cache.get(strategyId)!;
  }

  // Update account cache from WebSocket (called by user-data-stream)
  updateAccountFromWebSocket(strategyId: string, balances: any[]): void {
    const usdtBalance = balances.find((b: any) => b.asset === 'USDT');
    
    if (usdtBalance) {
      const snapshot = this.getSnapshot(strategyId);
      const walletBalance = usdtBalance.walletBalance || '0';
      const crossWalletBalance = usdtBalance.crossWalletBalance || '0';
      const unrealizedProfit = usdtBalance.unrealizedProfit || '0';
      const marginBalance = usdtBalance.marginBalance || '0';
      const initialMargin = usdtBalance.initialMargin || '0';
      
      // Match the HTTP API format exactly - include ALL fields the frontend expects
      snapshot.account = {
        feeTier: 0,
        canTrade: true,
        canDeposit: true,
        canWithdraw: true,
        updateTime: Date.now(),
        // Fields used by PerformanceOverview component
        totalWalletBalance: walletBalance,
        totalUnrealizedProfit: unrealizedProfit,
        totalMarginBalance: marginBalance,
        totalInitialMargin: initialMargin,
        availableBalance: crossWalletBalance,
        // Legacy fields for compatibility
        usdcBalance: walletBalance,
        usdtBalance: walletBalance,
        assets: [{
          a: 'USDT',
          wb: walletBalance,
          cw: crossWalletBalance,
          bc: '0'
        }]
      };
      snapshot.timestamp = Date.now();
      // Reduced logging - only log occasionally (every 30s) to reduce log spam
      if (Date.now() - this.lastAccountLogTime > 30000) {
        console.log('✅ Updated account cache from WebSocket (balance: $' + parseFloat(walletBalance).toFixed(2) + ')');
        this.lastAccountLogTime = Date.now();
      }
      this.broadcastSnapshot(strategyId);
    }
  }

  // Update positions cache from WebSocket (called by user-data-stream)
  updatePositionsFromWebSocket(strategyId: string, positions: any[]): void {
    const snapshot = this.getSnapshot(strategyId);
    
    // Filter to keep ONLY open positions (exclude closed positions with positionAmt=0)
    const openPositions = positions.filter((pos: any) => parseFloat(pos.positionAmt || '0') !== 0);
    
    snapshot.positions = openPositions;
    snapshot.timestamp = Date.now();
    // Reduced logging - only log occasionally (every 30s) to reduce log spam
    if (Date.now() - this.lastPositionsLogTime > 30000) {
      console.log(`✅ Updated positions cache from WebSocket (${positions.length} total, ${openPositions.length} open)`);
      this.lastPositionsLogTime = Date.now();
    }
    this.calculatePositionSummary(strategyId);
  }

  // Calculate simple summary from live positions
  private async calculatePositionSummary(strategyId: string): Promise<void> {
    try {
      const snapshot = this.getSnapshot(strategyId);
      const livePositions = snapshot.positions || [];

      // Calculate simple totals from live positions
      let totalExposure = 0;
      let unrealizedPnl = 0;

      for (const livePos of livePositions) {
        const positionValue = Math.abs(parseFloat(livePos.positionAmt || '0')) * parseFloat(livePos.entryPrice || '0');
        totalExposure += positionValue;
        // API returns unRealizedProfit (capital R), not unrealizedProfit
        unrealizedPnl += parseFloat(livePos.unRealizedProfit || livePos.unrealizedProfit || '0');
      }

      // Get account balance from cache
      const currentBalance = parseFloat(snapshot.account?.totalWalletBalance || '0');
      
      // Simple calculation
      const realizedPnl = 0; // Placeholder for now
      const totalPnl = realizedPnl + unrealizedPnl;
      const startingBalance = currentBalance - totalPnl;

      // Calculate portfolio risk (both filled and reserved)
      let filledRiskDollars = 0;
      let filledRiskPercentage = 0;
      let reservedRiskDollars = 0;
      let reservedRiskPercentage = 0;

      try {
        // Get active strategy and active session
        const strategy = await db.query.strategies.findFirst({
          where: eq(strategies.id, strategyId)
        });

        if (strategy) {
          const session = await db.query.tradeSessions.findFirst({
            where: and(
              eq(tradeSessions.strategyId, strategyId),
              eq(tradeSessions.isActive, true)
            )
          });

          if (session) {
            // Import strategyEngine singleton to access calculatePortfolioRisk
            const { strategyEngine } = await import('./strategy-engine');
            const portfolioRisk = await strategyEngine.calculatePortfolioRisk(strategy, session);
            filledRiskDollars = portfolioRisk.filledRisk;
            filledRiskPercentage = portfolioRisk.filledRiskPercentage;
            reservedRiskDollars = portfolioRisk.reservedRisk;
            reservedRiskPercentage = portfolioRisk.reservedRiskPercentage;
          }
        }
      } catch (riskError: any) {
        console.error(`⚠️ Error calculating portfolio risk:`, riskError.message);
        // Continue with zero risk values
      }

      snapshot.positionsSummary = {
        totalExposure,
        totalPnl,
        unrealizedPnl,
        realizedPnl,
        currentBalance,
        startingBalance,
        filledRiskDollars,
        filledRiskPercentage,
        reservedRiskDollars,
        reservedRiskPercentage
      };
      
      // Broadcast update
      this.broadcastSnapshot(strategyId);
    } catch (error: any) {
      console.error(`❌ Error calculating position summary:`, error.message);
    }
  }

  // Broadcast snapshot to all WebSocket clients
  private broadcastSnapshot(strategyId: string): void {
    const snapshot = this.getSnapshot(strategyId);
    wsBroadcaster.broadcast({
      type: 'live_snapshot',
      data: {
        snapshot: {
          strategyId,
          ...snapshot
        }
      },
      timestamp: Date.now()
    });
  }

  // Initialize for a strategy (no polling, just cache setup)
  start(strategyId: string): void {
    console.log(`✅ Live data cache ready for strategy ${strategyId} - data will arrive via WebSocket`);
    // Create empty snapshot - will be populated by WebSocket events
    this.getSnapshot(strategyId);
  }

  // Stop and clear cache for a strategy
  async stop(strategyId: string): Promise<void> {
    console.log(`🛑 Stopping live data for strategy ${strategyId}`);
    
    // Disconnect exchange stream
    await this.disconnectExchangeStream(strategyId);
    
    // Clear cache
    this.cache.delete(strategyId);
  }

  // Stop all and clear all caches
  async stopAll(): Promise<void> {
    console.log('🛑 Stopping all live data');
    
    // Disconnect all exchange streams
    const disconnectPromises = Array.from(this.exchangeStreams.keys()).map(strategyId =>
      this.disconnectExchangeStream(strategyId)
    );
    await Promise.all(disconnectPromises);
    
    // Clear all caches
    this.cache.clear();
  }
}

// Singleton instance
export const liveDataOrchestrator = new LiveDataOrchestrator();
