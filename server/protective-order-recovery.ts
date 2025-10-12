import { db } from './db.js';
import { positions, positionLayers } from '../shared/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { StrategyEngine } from './strategy-engine.js';

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

            // Place missing protective orders
            try {
              const orderResult = await (this.strategyEngine as any).placeLayerProtectiveOrders({
                position,
                layer,
                strategy,
              });

              if (orderResult.success && orderResult.tpOrderId && orderResult.slOrderId) {
                // Update layer with order IDs
                await db.update(positionLayers)
                  .set({
                    tpOrderId: orderResult.tpOrderId,
                    slOrderId: orderResult.slOrderId,
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
