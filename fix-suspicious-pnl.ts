import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

async function fixSuspiciousPnl() {
  console.log('🔍 Finding positions with suspicious P&L values...');

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
  let suspiciousCount = 0;

  for (const position of closedPositions) {
    const quantity = parseFloat(position.totalQuantity || '0');
    const avgEntry = parseFloat(position.avgEntryPrice || '0');
    const realizedPnl = parseFloat(position.realizedPnl || '0');

    if (quantity === 0 || avgEntry === 0) continue;

    // Calculate position notional value
    const notionalValue = quantity * avgEntry;

    // Check if P&L is suspiciously large (>95% of notional for loss, or >500% for gain)
    const lossRatio = Math.abs(realizedPnl) / notionalValue;
    const isSuspiciousLoss = realizedPnl < 0 && lossRatio >= 0.95; // 95%+ loss is suspicious
    const isSuspiciousGain = realizedPnl > 0 && lossRatio >= 5.0; // 500%+ gain is suspicious

    if (isSuspiciousLoss || isSuspiciousGain) {
      suspiciousCount++;

      console.log(`⚠️ SUSPICIOUS: ${position.symbol} ${position.side}`);
      console.log(`   Notional: $${notionalValue.toFixed(2)}, P&L: $${realizedPnl.toFixed(2)}`);
      console.log(`   Loss Ratio: ${(lossRatio * 100).toFixed(1)}%`);

      // Reset to 0 - these are likely wrong matches from the exchange API
      await db.update(positions)
        .set({ realizedPnl: '0' })
        .where(eq(positions.id, position.id));

      resetCount++;
      console.log(`   ✅ Reset to $0`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`   Suspicious P&L found: ${suspiciousCount}`);
  console.log(`   Reset to $0: ${resetCount}`);
  console.log(`   Total positions checked: ${closedPositions.length}`);
}

fixSuspiciousPnl().catch(console.error);
