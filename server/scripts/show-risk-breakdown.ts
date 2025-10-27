/**
 * Show detailed risk breakdown per position
 */

import { storage } from '../storage';

async function showRiskBreakdown() {
  console.log('📊 Risk Breakdown Per Position\n');

  try {
    const strategies = await storage.getAllActiveStrategies();
    if (strategies.length === 0) {
      console.log('No active strategies found.');
      return;
    }

    const strategy = strategies[0];
    const session = await storage.getActiveTradeSession(strategy.id);
    if (!session) {
      console.log('No active session found.');
      return;
    }

    const positions = await storage.getOpenPositions(session.id);
    if (positions.length === 0) {
      console.log('No open positions.');
      return;
    }

    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    let totalFilled = 0;
    let totalReserved = 0;

    console.log('Position                  | Filled Risk | Reserved Risk | Diff    | Source');
    console.log('--------------------------|-------------|---------------|---------|------------------');

    for (const pos of positions) {
      const qty = Math.abs(parseFloat(pos.totalQuantity));
      const avgPrice = parseFloat(pos.avgEntryPrice);

      // Calculate filled risk using stop loss
      const slPrice = pos.side === 'long'
        ? avgPrice * (1 - stopLossPercent / 100)
        : avgPrice * (1 + stopLossPercent / 100);

      const lossPerUnit = pos.side === 'long'
        ? avgPrice - slPrice
        : slPrice - avgPrice;

      const filledRisk = lossPerUnit * qty;
      const reservedRisk = pos.reservedRiskDollars
        ? parseFloat(pos.reservedRiskDollars)
        : filledRisk;

      const diff = reservedRisk - filledRisk;
      const source = pos.reservedRiskDollars ? 'stored' : 'calculated';
      const layers = `${pos.layersFilled || 0}/${pos.maxLayers}`;

      console.log(
        `${(pos.symbol + ' ' + pos.side).padEnd(25)} | ` +
        `$${filledRisk.toFixed(2).padStart(10)} | ` +
        `$${reservedRisk.toFixed(2).padStart(12)} | ` +
        `$${diff.toFixed(2).padStart(6)} | ` +
        `${source} (${layers})`
      );

      totalFilled += filledRisk;
      totalReserved += reservedRisk;
    }

    const totalDiff = totalReserved - totalFilled;

    console.log('--------------------------|-------------|---------------|---------|------------------');
    console.log(
      `${'TOTAL'.padEnd(25)} | ` +
      `$${totalFilled.toFixed(2).padStart(10)} | ` +
      `$${totalReserved.toFixed(2).padStart(12)} | ` +
      `$${totalDiff.toFixed(2).padStart(6)} |`
    );

    console.log(`\n💡 Extra reserved risk: $${totalDiff.toFixed(2)}`);
    console.log(`   This represents potential additional layers that could fill.`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the breakdown
showRiskBreakdown()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
