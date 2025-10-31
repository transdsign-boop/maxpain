import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();

const sql = neon(process.env.NEON_DATABASE_URL);

async function verifyRiskCalc() {
  try {
    // Get BTCUSDT short position (the big one with $856 risk)
    const btcShort = await sql`
      SELECT
        symbol,
        side,
        total_quantity,
        avg_entry_price,
        dca_schedule,
        opened_at
      FROM positions
      WHERE symbol = 'BTCUSDT'
        AND side = 'short'
        AND opened_at < '2025-10-28 20:05:17'
        AND (closed_at IS NULL OR closed_at > '2025-10-28 20:05:17')
      LIMIT 1
    `;

    if (btcShort.length === 0) {
      console.log('No BTCUSDT short found');
      return;
    }

    const pos = btcShort[0];
    const qty = Math.abs(parseFloat(pos.total_quantity));
    const entryPrice = parseFloat(pos.avg_entry_price);
    const positionNotional = qty * entryPrice;

    console.log('='.repeat(80));
    console.log('RISK CALCULATION VERIFICATION - BTCUSDT Short');
    console.log('='.repeat(80));
    console.log('');

    console.log('Position Details:');
    console.log(`  Symbol: ${pos.symbol}`);
    console.log(`  Side: ${pos.side}`);
    console.log(`  Opened: ${pos.opened_at.toISOString()}`);
    console.log(`  Quantity: ${qty.toFixed(8)}`);
    console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`  Position Notional: $${positionNotional.toFixed(2)}`);
    console.log('');

    // Extract stop loss from DCA schedule
    if (pos.dca_schedule && pos.dca_schedule.levels && pos.dca_schedule.levels[0]) {
      const stopLoss = parseFloat(pos.dca_schedule.levels[0].sl);

      console.log('Stop Loss:');
      console.log(`  Stop Loss Price: $${stopLoss.toFixed(2)}`);
      console.log('');

      // For a SHORT position:
      // - Entry at lower price (e.g., $94,000)
      // - Stop loss at higher price (e.g., $108,100)
      // - Loss = (Stop Loss - Entry Price) × Quantity

      const valueAtStopLoss = qty * stopLoss;
      const riskDollars = Math.abs(positionNotional - valueAtStopLoss);
      const riskPercent = (riskDollars / positionNotional) * 100;

      console.log('Risk Calculation:');
      console.log(`  Value at Entry: $${positionNotional.toFixed(2)}`);
      console.log(`  Value at Stop Loss: $${valueAtStopLoss.toFixed(2)}`);
      console.log(`  Risk (Loss if SL hits): $${riskDollars.toFixed(2)}`);
      console.log(`  Risk as % of Position: ${riskPercent.toFixed(2)}%`);
      console.log('');

      console.log('As % of $9,400 Account:');
      const accountRiskPercent = (riskDollars / 9400) * 100;
      console.log(`  This position's risk: ${accountRiskPercent.toFixed(2)}% of account`);
      console.log('');

      console.log('Verification:');
      console.log(`  ✅ Script showed: $856.83 risk`);
      console.log(`  ✅ Actual calculation: $${riskDollars.toFixed(2)} risk`);
      console.log(`  ${Math.abs(riskDollars - 856.83) < 1 ? '✅ MATCH!' : '❌ MISMATCH'}`);
    } else {
      console.log('⚠️ No DCA schedule found - cannot extract stop loss');
    }

    console.log('');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error:', error);
  }
}

verifyRiskCalc();
