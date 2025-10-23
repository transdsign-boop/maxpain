import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';

async function fixImpossiblePnl() {
  console.log('🔍 Finding positions with impossible P&L values...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  // Find all closed positions
  const closedPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false)
      )
    );

  console.log(`📊 Checking ${closedPositions.length} closed positions...`);

  let fixedCount = 0;
  let impossibleCount = 0;

  for (const position of closedPositions) {
    const quantity = parseFloat(position.totalQuantity || '0');
    const avgEntry = parseFloat(position.avgEntryPrice || '0');
    const leverage = (position as any).leverage || 1;
    const totalCost = parseFloat(position.totalCost || '0');
    const realizedPnl = parseFloat(position.realizedPnl || '0');

    if (quantity === 0 || avgEntry === 0) continue;

    // Calculate position notional value
    const notionalValue = quantity * avgEntry;
    const maxPossibleLoss = notionalValue; // Max loss is if price goes to $0 for long, or infinity for short (but realistically capped)
    const maxPossibleGain = notionalValue * 10; // Allow up to 10x gain (1000% profit)

    // Check if P&L is impossible
    const isImpossibleLoss = realizedPnl < -maxPossibleLoss * 1.1; // Allow 10% buffer for fees
    const isImpossibleGain = realizedPnl > maxPossibleGain;

    if (isImpossibleLoss || isImpossibleGain) {
      impossibleCount++;

      console.log(`❌ IMPOSSIBLE P&L: ${position.symbol} ${position.side}`);
      console.log(`   Quantity: ${quantity.toFixed(4)}, Entry: $${avgEntry.toFixed(4)}`);
      console.log(`   Notional: $${notionalValue.toFixed(2)}, P&L: $${realizedPnl.toFixed(2)}`);
      console.log(`   Max Loss: -$${maxPossibleLoss.toFixed(2)}, Max Gain: $${maxPossibleGain.toFixed(2)}`);

      // Reset to 0 - these are clearly wrong matches
      await db.update(positions)
        .set({ realizedPnl: '0' })
        .where(eq(positions.id, position.id));

      fixedCount++;
      console.log(`   ✅ Reset to $0`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`   Impossible P&L found: ${impossibleCount}`);
  console.log(`   Reset to $0: ${fixedCount}`);
  console.log(`   Total positions checked: ${closedPositions.length}`);
}

fixImpossiblePnl().catch(console.error);
