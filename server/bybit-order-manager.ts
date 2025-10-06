import { BybitClient, asterToBybitSymbol, bybitToAsterSymbol, asterToBybitSide } from './bybit-client';
import type { Position, Strategy } from '../shared/schema';

/**
 * Bybit Order Manager
 * 
 * Manages order execution and TP/SL for Bybit testnet trading.
 * Provides interface similar to Aster order management for seamless integration.
 */
export class BybitOrderManager {
  private client: BybitClient | null = null;
  private updateLocks = new Map<string, Promise<void>>();

  constructor() {}

  /**
   * Initialize Bybit client with API credentials
   */
  initialize(apiKey: string, apiSecret: string, endpoint: 'demo' | 'testnet' = 'demo') {
    this.client = new BybitClient(apiKey, apiSecret, endpoint);
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.client !== null;
  }

  /**
   * Test connection to Bybit testnet
   */
  async testConnection(): Promise<{ success: boolean; balance?: string; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Bybit client not initialized' };
    }
    return await this.client.testConnection();
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<{ balance: string; availableBalance: string }> {
    if (!this.client) {
      throw new Error('Bybit client not initialized');
    }
    return await this.client.getBalance();
  }

  /**
   * Execute entry order (open new position or add layer)
   */
  async executeEntryOrder(params: {
    symbol: string; // Aster format (e.g., "BTC-USDT")
    side: 'long' | 'short';
    quantity: string;
    orderType: 'market' | 'limit';
    price?: string;
    leverage: number;
  }): Promise<{ orderId: string; success: boolean; error?: string }> {
    try {
      if (!this.client) {
        throw new Error('Bybit client not initialized');
      }

      // Convert symbol format
      const bybitSymbol = asterToBybitSymbol(params.symbol);
      const bybitSide = asterToBybitSide(params.side);

      // Set leverage first
      await this.client.setLeverage(bybitSymbol, params.leverage);

      // Place order
      const result = await this.client.placeOrder({
        symbol: bybitSymbol,
        side: bybitSide,
        orderType: params.orderType === 'market' ? 'Market' : 'Limit',
        qty: params.quantity,
        price: params.price,
        positionIdx: 0, // One-way mode for now
      });

      return {
        orderId: result.orderId || '',
        success: true,
      };
    } catch (error: any) {
      return {
        orderId: '',
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update TP/SL for a position
   * Bybit natively supports TP/SL, no need for separate orders
   */
  async updateProtectiveOrders(
    position: Position,
    strategy: Strategy
  ): Promise<{ success: boolean; error?: string }> {
    const lockKey = this.getLockKey(position.symbol, position.side);
    const releaseLock = await this.acquireLock(lockKey);

    try {
      if (!this.client) {
        return { success: false, error: 'Bybit client not initialized' };
      }

      // Skip if not live/demo trading
      if (strategy.tradingMode !== 'demo') {
        return { success: true };
      }

      // Calculate TP/SL prices
      const { takeProfitPrice, stopLossPrice } = this.calculateTPSL(position, strategy);

      // Convert symbol format
      const bybitSymbol = asterToBybitSymbol(position.symbol);

      // Set TP/SL using Bybit's native trading stop
      await this.client.setTradingStop({
        symbol: bybitSymbol,
        side: position.side as 'long' | 'short',
        takeProfit: takeProfitPrice,
        stopLoss: stopLossPrice,
        positionIdx: 0,
      });

      console.log(`✅ Updated TP/SL for Bybit position ${position.symbol} ${position.side}: TP=${takeProfitPrice}, SL=${stopLossPrice}`);

      return { success: true };
    } catch (error: any) {
      console.error(`❌ Failed to update Bybit TP/SL for ${position.symbol}:`, error);
      return { success: false, error: error.message };
    } finally {
      releaseLock();
    }
  }

  /**
   * Close position by placing reduce-only order
   */
  async closePosition(params: {
    symbol: string;
    side: 'long' | 'short';
    quantity: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.client) {
        throw new Error('Bybit client not initialized');
      }

      const bybitSymbol = asterToBybitSymbol(params.symbol);
      
      // Close position by placing opposite side reduce-only order
      const closeSide = params.side === 'long' ? 'Sell' : 'Buy';
      
      await this.client.placeOrder({
        symbol: bybitSymbol,
        side: closeSide,
        orderType: 'Market',
        qty: params.quantity,
        reduceOnly: true,
        positionIdx: 0,
      });

      console.log(`✅ Closed Bybit position ${params.symbol} ${params.side}`);
      
      return { success: true };
    } catch (error: any) {
      console.error(`❌ Failed to close Bybit position:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current market price
   */
  async getCurrentPrice(symbol: string): Promise<string | null> {
    try {
      if (!this.client) return null;
      
      const bybitSymbol = asterToBybitSymbol(symbol);
      const ticker = await this.client.getTicker(bybitSymbol);
      
      return ticker.lastPrice || null;
    } catch (error) {
      console.error(`Failed to get price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch live position from Bybit exchange
   */
  async fetchLivePosition(symbol: string, side: 'long' | 'short'): Promise<{
    quantity: string;
    entryPrice: string;
    unrealizedPnl: string;
  } | null> {
    try {
      if (!this.client) return null;

      const bybitSymbol = asterToBybitSymbol(symbol);
      const positions = await this.client.getPositions();

      // Find matching position
      const position = positions.find(
        (p: any) => p.symbol === bybitSymbol && p.side === (side === 'long' ? 'Buy' : 'Sell')
      );

      if (!position || parseFloat(position.size) === 0) {
        return null;
      }

      return {
        quantity: position.size,
        entryPrice: position.avgPrice,
        unrealizedPnl: position.unrealisedPnl || '0',
      };
    } catch (error) {
      console.error(`Failed to fetch Bybit position for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Reconcile orphaned orders (not needed for Bybit - TP/SL are position-level)
   */
  async reconcileOrphanedOrders(sessionId: string): Promise<number> {
    // Bybit manages TP/SL at position level, no orphaned orders to clean up
    return 0;
  }

  /**
   * Verify all positions have correct TP/SL
   */
  async verifyAllPositions(sessionId: string, strategy: Strategy, positions: Position[]): Promise<void> {
    for (const position of positions) {
      await this.updateProtectiveOrders(position, strategy);
    }
  }

  /**
   * Calculate TP/SL prices based on position and strategy
   */
  private calculateTPSL(position: Position, strategy: Strategy): {
    takeProfitPrice: string;
    stopLossPrice: string;
  } {
    const entryPrice = parseFloat(position.avgEntryPrice);
    const profitTargetPercent = parseFloat(strategy.profitTargetPercent.toString());
    const stopLossPercent = parseFloat(strategy.stopLossPercent.toString());

    let takeProfitPrice: number;
    let stopLossPrice: number;

    if (position.side === 'long') {
      // Long position: TP above entry, SL below entry
      takeProfitPrice = entryPrice * (1 + profitTargetPercent / 100);
      stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    } else {
      // Short position: TP below entry, SL above entry
      takeProfitPrice = entryPrice * (1 - profitTargetPercent / 100);
      stopLossPrice = entryPrice * (1 + stopLossPercent / 100);
    }

    return {
      takeProfitPrice: takeProfitPrice.toFixed(2),
      stopLossPrice: stopLossPrice.toFixed(2),
    };
  }

  /**
   * Get lock key for position (symbol + side)
   */
  private getLockKey(symbol: string, side: string): string {
    return `${symbol}-${side}`;
  }

  /**
   * Acquire lock for position update
   */
  private async acquireLock(lockKey: string): Promise<() => void> {
    // Wait for existing lock to release
    while (this.updateLocks.has(lockKey)) {
      await this.updateLocks.get(lockKey);
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.updateLocks.set(lockKey, lockPromise);

    return () => {
      this.updateLocks.delete(lockKey);
      releaseLock!();
    };
  }
}

// Singleton instance
export const bybitOrderManager = new BybitOrderManager();
