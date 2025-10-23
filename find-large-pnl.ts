import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

async function findLargePnl() {
  console.log('🔍 Finding positions with large P&L values...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  const closedPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false)
      )
    );

  console.log(`📊 Checking ${closedPositions.length} positions...`);

  const largePnl = closedPositions
    .map(pos => ({
      ...pos,
      pnl: parseFloat(pos.realizedPnl || '0'),
      quantity: parseFloat(pos.totalQuantity || '0'),
      avgEntry: parseFloat(pos.avgEntryPrice || '0')
    }))
    .filter(pos => Math.abs(pos.pnl) > 1000)
    .sort((a, b) => a.pnl - b.pnl);

  console.log(`\n⚠️ Found ${largePnl.length} positions with P&L > $1,000:`);

  for (const pos of largePnl) {
    const notional = pos.quantity * pos.avgEntry;
    const lossRatio = notional > 0 ? Math.abs(pos.pnl) / notional : 0;
    console.log(`\n${pos.symbol} ${pos.side}:`);
    console.log(`   P&L: $${pos.pnl.toFixed(2)}`);
    console.log(`   Notional: $${notional.toFixed(2)}`);
    console.log(`   Loss Ratio: ${(lossRatio * 100).toFixed(1)}%`);
    console.log(`   Closed: ${pos.closedAt}`);
    console.log(`   ID: ${pos.id}`);
  }

  const totalPnl = closedPositions.reduce((sum, pos) => {
    const pnl = parseFloat(pos.realizedPnl || '0');
    return sum + pnl;
  }, 0);

  console.log(`\n💰 Total P&L: $${totalPnl.toFixed(2)}`);
}

findLargePnl().catch(console.error);
