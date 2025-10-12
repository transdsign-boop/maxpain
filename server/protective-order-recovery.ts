import { db } from './db.js';
import { positions, positionLayers } from '../shared/schema.js';
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
      console.log('🛡️ Checking for positions with missing protective orders...');

      // Get all open positions
      const openPositions = await db.select().from(positions).where(
        isNull(positions.closedAt)
      );

      if (openPositions.length === 0) {
        console.log('✅ No open positions found');
        return;
      }

      // Fetch all open orders from exchange ONCE for efficiency
      const exchangeOrders = await this.fetchAllOpenOrders();
      const exchangeOrderIds = new Set(exchangeOrders.map(o => o.orderId));

      let totalMissing = 0;
      let totalPlaced = 0;
      let totalFailed = 0;
      let totalStaleCleared = 0;

      for (const position of openPositions) {
        // Get all layers for this position
        const layers = await db.select().from(positionLayers).where(
          eq(positionLayers.positionId, position.id)
        );

        if (layers.length === 0) {
          continue; // No DCA layers, skip
        }

        for (const layer of layers) {
          // CRITICAL FIX: Verify order IDs actually exist on exchange, not just database
          let missingTP = !layer.tpOrderId;
          let missingSL = !layer.slOrderId;
          
          // Check if stored IDs are stale (no longer on exchange)
          if (layer.tpOrderId && !exchangeOrderIds.has(Number(layer.tpOrderId))) {
            console.log(`⚠️ Stale TP order ID ${layer.tpOrderId} for ${position.symbol} ${position.side} Layer ${layer.layerNumber} - clearing`);
            await db.update(positionLayers)
              .set({ tpOrderId: null })
              .where(eq(positionLayers.id, layer.id));
            missingTP = true;
            totalStaleCleared++;
          }
          
          if (layer.slOrderId && !exchangeOrderIds.has(Number(layer.slOrderId))) {
            console.log(`⚠️ Stale SL order ID ${layer.slOrderId} for ${position.symbol} ${position.side} Layer ${layer.layerNumber} - clearing`);
            await db.update(positionLayers)
              .set({ slOrderId: null })
              .where(eq(positionLayers.id, layer.id));
            missingSL = true;
            totalStaleCleared++;
          }

          if (missingTP || missingSL) {
            totalMissing++;
            console.log(`🔍 Found missing orders for ${position.symbol} ${position.side} Layer ${layer.layerNumber}: TP=${missingTP ? 'MISSING' : 'OK'}, SL=${missingSL ? 'MISSING' : 'OK'}`);

            // Find the strategy for this position
            const strategy = this.findStrategyForPosition(position);
            if (!strategy) {
              console.log(`❌ No active strategy found for position ${position.id}`);
              totalFailed++;
              continue;
            }

            // Recalculate TP/SL prices based on current ATR and market conditions
            try {
              const apiKey = process.env.ASTER_API_KEY;
              const secretKey = process.env.ASTER_SECRET_KEY;
              
              // Calculate current ATR
              const currentATR = await calculateATRPercent(position.symbol, 10, apiKey, secretKey);
              
              // Fetch DCA parameters
              const { getStrategyWithDCA } = await import('./dca-sql.js');
              const strategyWithDCA = await getStrategyWithDCA(strategy.id);
              
              if (!strategyWithDCA) {
                console.log(`❌ Could not load DCA settings for strategy ${strategy.id}`);
                totalFailed++;
                continue;
              }
              
              const layerEntryPrice = parseFloat(layer.entryPrice);
              let recalculatedTP: number;
              let recalculatedSL: number;
              
              // Recalculate TP using same logic as DCA calculator
              if (strategyWithDCA.adaptive_tp_enabled) {
                const tpAtrMultiplier = parseFloat(String(strategyWithDCA.tp_atr_multiplier || '1.5'));
                const minTpPercent = parseFloat(String(strategyWithDCA.min_tp_percent || '0.5'));
                const maxTpPercent = parseFloat(String(strategyWithDCA.max_tp_percent || '5.0'));
                
                const rawTpPercent = currentATR * tpAtrMultiplier;
                const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
                
                recalculatedTP = position.side === 'long'
                  ? layerEntryPrice * (1 + clampedTpPercent / 100)
                  : layerEntryPrice * (1 - clampedTpPercent / 100);
              } else {
                // Fallback: Use exitCushion multiplier
                const exitCushion = parseFloat(String(strategyWithDCA.dca_exit_cushion_multiplier));
                const tpDistance = exitCushion * (currentATR / 100) * layerEntryPrice;
                recalculatedTP = position.side === 'long' 
                  ? layerEntryPrice + tpDistance
                  : layerEntryPrice - tpDistance;
              }
              
              // Recalculate SL using same logic as DCA calculator
              if (strategyWithDCA.adaptive_sl_enabled) {
                const slAtrMultiplier = parseFloat(String(strategyWithDCA.sl_atr_multiplier || '2.0'));
                const minSlPercent = parseFloat(String(strategyWithDCA.min_sl_percent || '1.0'));
                const maxSlPercent = parseFloat(String(strategyWithDCA.max_sl_percent || '5.0'));
                
                const rawSlPercent = currentATR * slAtrMultiplier;
                const clampedSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
                
                recalculatedSL = position.side === 'long'
                  ? layerEntryPrice * (1 - clampedSlPercent / 100)
                  : layerEntryPrice * (1 + clampedSlPercent / 100);
              } else {
                // Fallback: Use fixed stopLossPercent
                const stopLossPercent = parseFloat(String(strategy.stopLossPercent));
                recalculatedSL = position.side === 'long'
                  ? layerEntryPrice * (1 - stopLossPercent / 100)
                  : layerEntryPrice * (1 + stopLossPercent / 100);
              }
              
              // Get current market price for validation (with exchange API fallback)
              const currentPrice = await (this.strategyEngine as any).getCurrentPrice(position.symbol);
              
              if (!currentPrice) {
                // Can't validate TP/SL without current market price - skip for now
                console.log(`⏭️ Skipping Layer ${layer.layerNumber} protective orders - failed to fetch current market price`);
                console.log(`   Will retry in next reconciliation cycle (60s)`);
                continue;
              }
              
              // Validate and adjust TP price based on current market price
              let validTP = recalculatedTP;
              
              if (position.side === 'short') {
                // SHORT TP is a BUY LIMIT - must be <= current price
                if (recalculatedTP > currentPrice) {
                  validTP = currentPrice * 0.998; // 0.2% below current price for safety
                  console.log(`⚠️ Adjusted SHORT TP from $${recalculatedTP.toFixed(6)} to $${validTP.toFixed(6)} (market at $${currentPrice.toFixed(6)})`);
                }
              } else {
                // LONG TP is a SELL LIMIT - must be >= current price
                if (recalculatedTP < currentPrice) {
                  validTP = currentPrice * 1.002; // 0.2% above current price for safety
                  console.log(`⚠️ Adjusted LONG TP from $${recalculatedTP.toFixed(6)} to $${validTP.toFixed(6)} (market at $${currentPrice.toFixed(6)})`);
                }
              }
              
              console.log(`🔄 Recalculated TP/SL: Entry=$${layerEntryPrice.toFixed(6)}, Market=$${currentPrice.toFixed(6)}, TP=$${validTP.toFixed(6)}, SL=$${recalculatedSL.toFixed(6)} (ATR=${currentATR.toFixed(2)}%)`);
              
              // Create modified layer with recalculated prices
              const layerWithRecalculatedPrices = {
                ...layer,
                takeProfitPrice: validTP.toString(),
                stopLossPrice: recalculatedSL.toFixed(6),
              };
              
              // Place protective orders with recalculated prices
              const orderResult = await (this.strategyEngine as any).placeLayerProtectiveOrders({
                position,
                layer: layerWithRecalculatedPrices,
                strategy,
              });

              if (orderResult.success && orderResult.tpOrderId && orderResult.slOrderId) {
                // Update layer with order IDs AND validated prices
                await db.update(positionLayers)
                  .set({
                    tpOrderId: orderResult.tpOrderId,
                    slOrderId: orderResult.slOrderId,
                    takeProfitPrice: validTP.toString(),
                    stopLossPrice: recalculatedSL.toString(),
                  })
                  .where(eq(positionLayers.id, layer.id));

                console.log(`✅ Placed protective orders for ${position.symbol} ${position.side} Layer ${layer.layerNumber}: TP=${orderResult.tpOrderId}, SL=${orderResult.slOrderId}`);
                totalPlaced++;
              } else {
                console.log(`❌ Failed to place protective orders for ${position.symbol} ${position.side} Layer ${layer.layerNumber}: ${orderResult.error || 'Unknown error'}`);
                totalFailed++;
              }
            } catch (error) {
              console.error(`❌ Error placing protective orders for ${position.symbol} ${position.side} Layer ${layer.layerNumber}:`, error);
              totalFailed++;
            }
          }
        }
      }

      if (totalStaleCleared > 0) {
        console.log(`🧹 Cleared ${totalStaleCleared} stale order IDs from database`);
      }
      
      if (totalMissing === 0) {
        console.log('✅ All positions have protective orders in place');
      } else {
        console.log(`🛡️ Protective order recovery complete: ${totalPlaced} placed, ${totalFailed} failed out of ${totalMissing} missing`);
      }
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
