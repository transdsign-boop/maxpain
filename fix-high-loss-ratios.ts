import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

async function fixHighLossRatios() {
  console.log('🔍 Finding positions with 70-94% loss ratios...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  const closedPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false)
      )
    );

  console.log(`📊 Checking ${closedPositions.length} closed positions...`);

  let resetCount = 0;

  for (const position of closedPositions) {
    const quantity = parseFloat(position.totalQuantity || '0');
    const avgEntry = parseFloat(position.avgEntryPrice || '0');
    const realizedPnl = parseFloat(position.realizedPnl || '0');

    if (quantity === 0 || avgEntry === 0 || realizedPnl >= 0) continue;

    const notionalValue = quantity * avgEntry;
    const lossRatio = Math.abs(realizedPnl) / notionalValue;

    // Reset positions with 70-94% loss ratios (likely bad matches)
    if (lossRatio >= 0.70 && lossRatio < 0.95) {
      resetCount++;

      console.log(`⚠️ HIGH LOSS RATIO: ${position.symbol} ${position.side}`);
      console.log(`   Notional: $${notionalValue.toFixed(2)}, P&L: $${realizedPnl.toFixed(2)}`);
      console.log(`   Loss Ratio: ${(lossRatio * 100).toFixed(1)}%`);

      await db.update(positions)
        .set({ realizedPnl: '0' })
        .where(eq(positions.id, position.id));

      console.log(`   ✅ Reset to $0`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`   High loss ratios found: ${resetCount}`);
  console.log(`   Reset to $0: ${resetCount}`);
}

fixHighLossRatios().catch(console.error);
