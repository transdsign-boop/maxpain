import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies, positions } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

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
  private polling: Map<string, NodeJS.Timeout> = new Map();
  private inflightRequests: Map<string, Promise<any>> = new Map();
  private backoffTimers: Map<string, number> = new Map();
  private readonly MIN_BACKOFF_MS = 5000;
  private readonly MAX_BACKOFF_MS = 60000;

  constructor() {
    console.log('🎯 Live Data Orchestrator initialized');
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

  // Deduplicated fetch with promise memoization
  private async fetchWithDedupe<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // If request is already in flight, return the same promise
    if (this.inflightRequests.has(key)) {
      console.log(`⏳ Deduplicating request: ${key}`);
      return this.inflightRequests.get(key) as Promise<T>;
    }

    // Create new request
    const promise = fetcher()
      .finally(() => {
        // Remove from inflight when done
        this.inflightRequests.delete(key);
      });

    this.inflightRequests.set(key, promise);
    return promise;
  }

  // Fetch account data from Aster DEX
  private async fetchAsterAccount(): Promise<any> {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;

    if (!apiKey || !secretKey) {
      throw new Error('API credentials not configured');
    }

    const timestamp = Date.now();
    const params = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(params)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v1/account?${params}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      const error = await response.text();
      throw new Error(`Aster API error: ${error}`);
    }

    return await response.json();
  }

  // Fetch positions data from Aster DEX
  private async fetchAsterPositions(): Promise<any[]> {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;

    if (!apiKey || !secretKey) {
      throw new Error('API credentials not configured');
    }

    const timestamp = Date.now();
    const params = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(params)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v2/positionRisk?${params}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      const error = await response.text();
      throw new Error(`Aster API error: ${error}`);
    }

    return await response.json();
  }

  // Fetch account data with backoff on 429
  private async fetchAccountData(strategyId: string): Promise<void> {
    const key = `account:${strategyId}`;
    
    // Check if we're in backoff
    const backoffUntil = this.backoffTimers.get(key) || 0;
    if (Date.now() < backoffUntil) {
      console.log(`⏸️  Skipping account fetch (backoff until ${new Date(backoffUntil).toISOString()})`);
      return;
    }

    try {
      const account = await this.fetchWithDedupe(key, () => this.fetchAsterAccount());

      // Success - update cache and clear backoff
      const snapshot = this.getSnapshot(strategyId);
      snapshot.account = account;
      snapshot.timestamp = Date.now();
      snapshot.error = null;
      this.backoffTimers.delete(key);
      
      // Broadcast update
      this.broadcastSnapshot(strategyId);
    } catch (error: any) {
      // Handle 429 with exponential backoff
      if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
        const currentBackoff = this.backoffTimers.get(key) || this.MIN_BACKOFF_MS;
        const nextBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF_MS);
        this.backoffTimers.set(key, Date.now() + nextBackoff);
        console.log(`🚫 Rate limited on account - backing off ${nextBackoff}ms`);
      } else {
        console.error(`❌ Error fetching account:`, error.message);
        const snapshot = this.getSnapshot(strategyId);
        snapshot.error = error.message;
      }
    }
  }

  // Fetch positions data with backoff on 429
  private async fetchPositionsData(strategyId: string): Promise<void> {
    const key = `positions:${strategyId}`;
    
    // Check if we're in backoff
    const backoffUntil = this.backoffTimers.get(key) || 0;
    if (Date.now() < backoffUntil) {
      console.log(`⏸️  Skipping positions fetch (backoff until ${new Date(backoffUntil).toISOString()})`);
      return;
    }

    try {
      const positionsData = await this.fetchWithDedupe(key, () => this.fetchAsterPositions());

      // Success - update cache and clear backoff
      const snapshot = this.getSnapshot(strategyId);
      snapshot.positions = positionsData;
      snapshot.timestamp = Date.now();
      snapshot.error = null;
      this.backoffTimers.delete(key);
      
      // Broadcast update
      this.broadcastSnapshot(strategyId);
    } catch (error: any) {
      // Handle 429 with exponential backoff
      if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
        const currentBackoff = this.backoffTimers.get(key) || this.MIN_BACKOFF_MS;
        const nextBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF_MS);
        this.backoffTimers.set(key, Date.now() + nextBackoff);
        console.log(`🚫 Rate limited on positions - backing off ${nextBackoff}ms`);
      } else {
        console.error(`❌ Error fetching positions:`, error.message);
        const snapshot = this.getSnapshot(strategyId);
        snapshot.error = error.message;
      }
    }
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

  // Start polling for a strategy
  startPolling(strategyId: string): void {
    if (this.polling.has(strategyId)) {
      console.log(`✓ Already polling for strategy ${strategyId}`);
      return;
    }

    console.log(`🚀 Starting live data polling for strategy ${strategyId}`);

    // Staggered polling intervals
    const accountInterval = setInterval(() => {
      this.fetchAccountData(strategyId);
    }, 15000); // Every 15 seconds

    const positionsInterval = setInterval(() => {
      this.fetchPositionsData(strategyId);
    }, 10000); // Every 10 seconds

    const summaryInterval = setInterval(() => {
      this.calculatePositionSummary(strategyId);
    }, 10000); // Every 10 seconds

    // Store all timers
    this.polling.set(strategyId, accountInterval);
    this.polling.set(`${strategyId}:positions`, positionsInterval);
    this.polling.set(`${strategyId}:summary`, summaryInterval);

    // Initial fetch (staggered)
    setTimeout(() => this.fetchAccountData(strategyId), 100);
    setTimeout(() => this.fetchPositionsData(strategyId), 500);
    setTimeout(() => this.calculatePositionSummary(strategyId), 1000);
  }

  // Stop polling for a strategy
  stopPolling(strategyId: string): void {
    console.log(`🛑 Stopping live data polling for strategy ${strategyId}`);
    
    const timers = [
      this.polling.get(strategyId),
      this.polling.get(`${strategyId}:positions`),
      this.polling.get(`${strategyId}:summary`)
    ];

    timers.forEach(timer => {
      if (timer) clearInterval(timer);
    });

    this.polling.delete(strategyId);
    this.polling.delete(`${strategyId}:positions`);
    this.polling.delete(`${strategyId}:summary`);
    this.cache.delete(strategyId);
  }

  // Stop all polling
  stopAll(): void {
    console.log('🛑 Stopping all live data polling');
    this.polling.forEach((timer) => clearInterval(timer));
    this.polling.clear();
    this.cache.clear();
    this.inflightRequests.clear();
    this.backoffTimers.clear();
  }
}

// Singleton instance
export const liveDataOrchestrator = new LiveDataOrchestrator();
