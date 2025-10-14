import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies, tradeSessions } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

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

  constructor() {
    console.log('🎯 Live Data Orchestrator initialized - 100% WebSocket mode (NO POLLING)');
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
  stop(strategyId: string): void {
    console.log(`🛑 Clearing live data cache for strategy ${strategyId}`);
    this.cache.delete(strategyId);
  }

  // Stop all and clear all caches
  stopAll(): void {
    console.log('🛑 Clearing all live data caches');
    this.cache.clear();
  }
}

// Singleton instance
export const liveDataOrchestrator = new LiveDataOrchestrator();
