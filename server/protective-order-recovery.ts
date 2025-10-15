import { db } from './db.js';
import { positions } from '../shared/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { StrategyEngine } from './strategy-engine.js';
import { calculateATRPercent } from './dca-calculator.js';

export class ProtectiveOrderRecovery {
  private strategyEngine: StrategyEngine;
  private isRunning = false;

  constructor(strategyEngine: StrategyEngine) {
    this.strategyEngine = strategyEngine;
  }

  async checkAndPlaceMissingOrders(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️ Protective order recovery already running, skipping...');
      return;
    }

    try {
      this.isRunning = true;
      console.log('🛡️ SIMPLIFIED: Protective order recovery disabled - position-level TP/SL managed by OrderProtectionService');
      
      // SIMPLIFIED APPROACH: No layer-specific protective order recovery
      // The OrderProtectionService handles position-level TP/SL based on average entry price
      // No need to check or place individual layer orders
      
    } catch (error) {
      console.error('❌ Error in protective order recovery:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch all open orders from exchange to verify stored order IDs
   */
  private async fetchAllOpenOrders(): Promise<Array<{ orderId: number; symbol: string; type: string }>> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.log('⚠️ Missing API credentials, cannot verify exchange orders');
        return [];
      }
      
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      
      const crypto = await import('crypto');
      const signature = crypto.createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');
      
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );
      
      if (!response.ok) {
        console.log(`⚠️ Failed to fetch exchange orders: ${response.status} ${response.statusText}`);
        return [];
      }
      
      const orders = await response.json();
      console.log(`📊 Fetched ${orders.length} open orders from exchange for verification`);
      
      return orders.map((o: any) => ({
        orderId: o.orderId,
        symbol: o.symbol,
        type: o.type
      }));
    } catch (error) {
      console.error('❌ Error fetching exchange orders for verification:', error);
      return [];
    }
  }

  private findStrategyForPosition(position: any): any {
    // Access the strategy engine's active strategies
    const activeStrategies = (this.strategyEngine as any).activeStrategies;
    const activeSessions = (this.strategyEngine as any).activeSessions;

    for (const [strategyId, strategy] of activeStrategies) {
      const session = activeSessions.get(strategyId);
      if (session && session.id === position.sessionId) {
        return strategy;
      }
    }

    return null;
  }
}
