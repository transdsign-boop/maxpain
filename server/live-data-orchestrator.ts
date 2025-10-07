import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface LiveSnapshot {
  account: {
    availableBalance: number;
    totalWalletBalance: number;
    totalUnrealizedProfit: number;
    totalMarginBalance: number;
    totalPositionInitialMargin: number;
    canTrade: boolean;
    canWithdraw: boolean;
    updateTime: number;
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
      snapshot.account = {
        availableBalance: parseFloat(usdtBalance.crossWalletBalance || '0'),
        totalWalletBalance: parseFloat(usdtBalance.walletBalance || '0'),
        totalUnrealizedProfit: 0,
        totalMarginBalance: parseFloat(usdtBalance.crossWalletBalance || '0'),
        totalPositionInitialMargin: 0,
        canTrade: true,
        canWithdraw: true,
        updateTime: Date.now()
      };
      snapshot.timestamp = Date.now();
      console.log('✅ Updated account cache from WebSocket (balance: $' + snapshot.account.availableBalance.toFixed(2) + ')');
      this.broadcastSnapshot(strategyId);
    }
  }

  // Update positions cache from WebSocket (called by user-data-stream)
  updatePositionsFromWebSocket(strategyId: string, positions: any[]): void {
    const snapshot = this.getSnapshot(strategyId);
    snapshot.positions = positions;
    snapshot.timestamp = Date.now();
    console.log(`✅ Updated positions cache from WebSocket (${positions.length} positions)`);
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

      // Get account balance from cache
      const currentBalance = snapshot.account?.totalWalletBalance || 0;
      
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
