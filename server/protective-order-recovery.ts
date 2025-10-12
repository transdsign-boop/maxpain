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

      let totalMissing = 0;
      let totalPlaced = 0;
      let totalFailed = 0;

      for (const position of openPositions) {
        // Get all layers for this position
        const layers = await db.select().from(positionLayers).where(
          eq(positionLayers.positionId, position.id)
        );

        if (layers.length === 0) {
          continue; // No DCA layers, skip
        }

        for (const layer of layers) {
          const missingTP = !layer.tpOrderId;
          const missingSL = !layer.slOrderId;

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
