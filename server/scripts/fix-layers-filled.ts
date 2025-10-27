/**
 * Fix layersFilled count for all open positions by counting actual fills
 *
 * This script:
 * 1. Gets all open positions
 * 2. Counts fills for each position from fills table
 * 3. Updates layersFilled to match actual fill count
 */

import { storage } from '../storage';

async function fixLayersFilled(strategyId?: string) {
  console.log('🔧 Starting layersFilled fix...\n');

  try {
    // If no strategy ID provided, try to find active strategies
    if (!strategyId) {
      const activeStrategies = await storage.getAllActiveStrategies();
      if (activeStrategies.length === 0) {
        console.log('No active strategies found.');
        return;
      }
      strategyId = activeStrategies[0].id;
      console.log(`Using strategy: ${activeStrategies[0].name} (${strategyId})\n`);
    }

    const strategy = await storage.getStrategy(strategyId);
    if (!strategy) {
      console.log(`Strategy ${strategyId} not found.`);
      return;
    }

    // Get live session for this strategy
    const liveSession = await storage.getActiveTradeSession(strategyId);
    if (!liveSession) {
      console.log(`No active session found for strategy ${strategy.name}`);
      return;
    }

    const positions = await storage.getOpenPositions(liveSession.id);

    if (positions.length === 0) {
      console.log(`No open positions found.`);
      return;
    }

    console.log(`📊 Found ${positions.length} open positions\n`);

    let fixedCount = 0;

    for (const position of positions) {
      // Count actual fills for this position
      const fills = await storage.getFillsByPosition(position.id);
      const actualLayersFilled = fills.length;
      const currentLayersFilled = position.layersFilled || 0;

      console.log(`${position.symbol} ${position.side}:`);
      console.log(`  Current layersFilled: ${currentLayersFilled}`);
      console.log(`  Actual fills count: ${actualLayersFilled}`);

      if (actualLayersFilled !== currentLayersFilled) {
        console.log(`  ✅ Updating to ${actualLayersFilled}...\n`);

        await storage.updatePosition(position.id, {
          layersFilled: actualLayersFilled,
          layersPlaced: Math.max(actualLayersFilled, position.layersPlaced || 0),
        });

        fixedCount++;
      } else {
        console.log(`  ✓ Already correct\n`);
      }
    }

    if (fixedCount > 0) {
      console.log(`\n✅ Fixed ${fixedCount} positions!`);
    } else {
      console.log(`\n✅ All positions already have correct layer counts!`);
    }
  } catch (error) {
    console.error('❌ Error fixing layersFilled:', error);
    throw error;
  }
}

// Run the fix
fixLayersFilled()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
