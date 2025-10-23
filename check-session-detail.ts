import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function checkSessionDetail() {
  const sessionId = '2b4478ae-09f0-446e-90b9-a22b444156e4';

  console.log(`🔍 Checking session ${sessionId}...`);

  const sessionPositions = await db.select().from(positions)
    .where(eq(positions.sessionId, sessionId));

  const closedPositions = sessionPositions.filter(p => !p.isOpen);

  console.log(`📊 Found ${closedPositions.length} closed positions`);

  // Find positions with large losses
  const largeLosses = closedPositions
    .map(pos => ({
      ...pos,
      pnl: parseFloat(pos.realizedPnl || '0'),
      quantity: parseFloat(pos.totalQuantity || '0'),
      avgEntry: parseFloat(pos.avgEntryPrice || '0')
    }))
    .filter(pos => pos.pnl < -500)
    .sort((a, b) => a.pnl - b.pnl);

  console.log(`\n⚠️ Found ${largeLosses.length} positions with losses > $500:\n`);

  let totalLargeLosses = 0;
  for (const pos of largeLosses.slice(0, 20)) {
    const notional = pos.quantity * pos.avgEntry;
    const lossRatio = notional > 0 ? Math.abs(pos.pnl) / notional : 0;
    console.log(`${pos.symbol} ${pos.side}: P&L $${pos.pnl.toFixed(2)}, Notional $${notional.toFixed(2)}, Loss Ratio ${(lossRatio * 100).toFixed(1)}%`);
    totalLargeLosses += pos.pnl;
  }

  console.log(`\n💰 Total from top ${Math.min(20, largeLosses.length)} large losses: $${totalLargeLosses.toFixed(2)}`);

  const totalPnl = closedPositions.reduce((sum, pos) => sum + parseFloat(pos.realizedPnl || '0'), 0);
  console.log(`💰 Total session P&L: $${totalPnl.toFixed(2)}`);
}

checkSessionDetail().catch(console.error);
