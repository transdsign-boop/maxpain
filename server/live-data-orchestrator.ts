import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface LiveSnapshot {
  account: {
    feeTier: number;
    canTrade: boolean;
    canDeposit: boolean;
    canWithdraw: boolean;
    updateTime: number;
    totalWalletBalance: string;
    totalUnrealizedProfit: string;
    totalMarginBalance: string;
    totalInitialMargin: string;
    availableBalance: string;
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
  } | null;
  timestamp: number;
  error: string | null;
}

class LiveDataOrchestrator {
  private cache: Map<string, LiveSnapshot> = new Map();

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
      
      // WebSocket ACCOUNT_UPDATE fields:
      // wb = wallet balance (totalWalletBalance)
      // cw = cross wallet balance (availableBalance)
      const walletBalance = parseFloat(usdtBalance.walletBalance || '0');
      const availableBalance = parseFloat(usdtBalance.crossWalletBalance || '0');
      
      // Calculate unrealized profit from positions if we have them (ONLY open positions with non-zero amount)
      let unrealizedProfit = 0;
      if (snapshot.positions && snapshot.positions.length > 0) {
        unrealizedProfit = snapshot.positions.reduce((sum, pos) => {
          // Only include positions with non-zero position amount
          const positionAmt = parseFloat(pos.positionAmt || '0');
          if (positionAmt !== 0) {
            return sum + parseFloat(pos.unrealizedProfit || '0');
          }
          return sum;
        }, 0);
      }
      
      // Calculate marginBalance = walletBalance + unrealizedProfit
      const marginBalance = walletBalance + unrealizedProfit;
      
      // Calculate initial margin (used margin) = walletBalance - availableBalance
      const initialMargin = Math.max(0, walletBalance - availableBalance);
      
      // Match the HTTP API format exactly - include ALL fields the frontend expects
      snapshot.account = {
        feeTier: 0,
        canTrade: true,
        canDeposit: true,
        canWithdraw: true,
        updateTime: Date.now(),
        // Fields used by PerformanceOverview component
        totalWalletBalance: walletBalance.toString(),
        totalUnrealizedProfit: unrealizedProfit.toString(),
        totalMarginBalance: marginBalance.toString(),
        totalInitialMargin: initialMargin.toString(),
        availableBalance: availableBalance.toString(),
        // Legacy fields for compatibility
        usdcBalance: walletBalance.toString(),
        usdtBalance: walletBalance.toString(),
        assets: [{
          a: 'USDT',
          wb: walletBalance.toString(),
          cw: availableBalance.toString(),
          bc: '0'
        }]
      };
      snapshot.timestamp = Date.now();
      console.log(`✅ Updated account from WebSocket: wallet=$${walletBalance.toFixed(2)}, available=$${availableBalance.toFixed(2)}, unrealized=$${unrealizedProfit.toFixed(2)}, margin=$${marginBalance.toFixed(2)}`);
      this.broadcastSnapshot(strategyId);
    }
  }

  // Update positions cache from WebSocket (called by user-data-stream)
  updatePositionsFromWebSocket(strategyId: string, positions: any[]): void {
    const snapshot = this.getSnapshot(strategyId);
    snapshot.positions = positions;
    snapshot.timestamp = Date.now();
    console.log(`✅ Updated positions cache from WebSocket (${positions.length} positions)`);
    
    // Recalculate account balance with new unrealized P&L from positions
    if (snapshot.account) {
      const walletBalance = parseFloat(snapshot.account.totalWalletBalance || '0');
      
      // Calculate unrealized profit from updated positions (ONLY open positions with non-zero amount)
      let unrealizedProfit = 0;
      const openPositions: any[] = [];
      if (positions && positions.length > 0) {
        unrealizedProfit = positions.reduce((sum, pos) => {
          // Only include positions with non-zero position amount
          const positionAmt = parseFloat(pos.positionAmt || '0');
          if (positionAmt !== 0) {
            openPositions.push({ symbol: pos.symbol, amt: positionAmt, unrealized: pos.unrealizedProfit });
            return sum + parseFloat(pos.unrealizedProfit || '0');
          }
          return sum;
        }, 0);
      }
      
      if (openPositions.length > 0) {
        console.log(`📊 Open positions from WebSocket:`, JSON.stringify(openPositions));
      }
      
      // Recalculate marginBalance with new unrealized P&L
      const marginBalance = walletBalance + unrealizedProfit;
      
      // Update account fields
      snapshot.account.totalUnrealizedProfit = unrealizedProfit.toString();
      snapshot.account.totalMarginBalance = marginBalance.toString();
      
      console.log(`🔄 Recalculated balances from positions: unrealized=$${unrealizedProfit.toFixed(2)}, margin=$${marginBalance.toFixed(2)}`);
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
        unrealizedPnl += parseFloat(livePos.unrealizedProfit || '0');
      }

      // Get account balance from cache (parse string to number)
      const currentBalance = parseFloat(snapshot.account?.totalWalletBalance || '0');
      
      // Simple calculation
      const realizedPnl = 0; // Placeholder for now
      const totalPnl = realizedPnl + unrealizedPnl;
      const startingBalance = currentBalance - totalPnl;

      snapshot.positionsSummary = {
        totalExposure,
        totalPnl,
        unrealizedPnl,
        realizedPnl,
        currentBalance,
        startingBalance
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
