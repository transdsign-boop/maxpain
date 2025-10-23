import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

async function findNanPnl() {
  console.log('🔍 Finding positions with NaN or invalid P&L...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  const closedPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false)
      )
    );

  console.log(`📊 Checking ${closedPositions.length} positions...`);

  let invalidCount = 0;

  for (const position of closedPositions) {
    const pnlStr = position.realizedPnl;
    const pnlNum = parseFloat(position.realizedPnl || '0');

    if (isNaN(pnlNum) || pnlStr === null || pnlStr === undefined || pnlStr === 'NaN' || pnlStr === 'null') {
      invalidCount++;
      console.log(`❌ Invalid P&L: ${position.symbol} ${position.side}`);
      console.log(`   realizedPnl value: "${pnlStr}" (type: ${typeof pnlStr})`);
      console.log(`   parsed as: ${pnlNum}`);
      console.log(`   Position ID: ${position.id}`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`   Invalid P&L found: ${invalidCount}`);
  console.log(`   Valid positions: ${closedPositions.length - invalidCount}`);
}

findNanPnl().catch(console.error);
