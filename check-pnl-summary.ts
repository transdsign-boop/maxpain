import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

async function checkPnlSummary() {
  console.log('📊 Checking P&L data summary...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  const closedPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false)
      )
    );

  console.log(`\n📈 Total closed positions: ${closedPositions.length}`);

  let totalPnl = 0;
  let zeroCount = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let impossibleCount = 0;

  for (const position of closedPositions) {
    const pnl = parseFloat(position.realizedPnl || '0');
    const quantity = parseFloat(position.totalQuantity || '0');
    const avgEntry = parseFloat(position.avgEntryPrice || '0');
    const notional = quantity * avgEntry;

    totalPnl += pnl;

    if (pnl === 0) {
      zeroCount++;
    } else if (pnl > 0) {
      positiveCount++;
    } else {
      negativeCount++;
    }

    // Check for impossible values
    if (notional > 0) {
      const lossRatio = Math.abs(pnl) / notional;
      if ((pnl < 0 && lossRatio >= 0.95) || (pnl > 0 && lossRatio >= 5.0)) {
        impossibleCount++;
        console.log(`⚠️ Still suspicious: ${position.symbol} ${position.side} - Notional: $${notional.toFixed(2)}, P&L: $${pnl.toFixed(2)}, Ratio: ${(lossRatio * 100).toFixed(1)}%`);
      }
    }
  }

  console.log(`\n💰 Summary:`);
  console.log(`   Total Realized P&L: $${totalPnl.toFixed(2)}`);
  console.log(`   Winning positions: ${positiveCount}`);
  console.log(`   Losing positions: ${negativeCount}`);
  console.log(`   Zero P&L positions: ${zeroCount}`);
  console.log(`   Suspicious P&L (still): ${impossibleCount}`);
  console.log(`\n   Win Rate: ${((positiveCount / (positiveCount + negativeCount)) * 100).toFixed(2)}%`);
}

checkPnlSummary().catch(console.error);
