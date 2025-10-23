import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';

async function showExactQuery() {
  console.log('\n🔍 EXACT QUERY I\'M RUNNING:\n');
  console.log('Table: positions');
  console.log('Filtering by these session IDs:');

  const activeSessions = [
    '2b4478ae-09f0-446e-90b9-a22b444156e4',
    '715c61d4-d238-4a51-98a3-0550f1865b90',
    'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6',
    '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'
  ];

  activeSessions.forEach((id, i) => console.log(`   ${i+1}. ${id}`));

  console.log('\n📊 Fetching all positions for these sessions...\n');

  const allPositions = await db.select().from(positions)
    .where(inArray(positions.sessionId, activeSessions));

  console.log(`Total positions found: ${allPositions.length}`);

  const closedPositions = allPositions.filter(p => !p.isOpen);
  console.log(`Closed positions: ${closedPositions.length}`);

  console.log('\n💰 Sample of closed positions with realizedPnl:\n');

  // Show first 10 closed positions
  closedPositions.slice(0, 10).forEach((pos, i) => {
    console.log(`${i+1}. ${pos.symbol} ${pos.side}:`);
    console.log(`   Session: ${pos.sessionId}`);
    console.log(`   realizedPnl (from DB): "${pos.realizedPnl}"`);
    console.log(`   Closed at: ${pos.closedAt}`);
    console.log('');
  });

  // Calculate total P&L
  let totalPnl = 0;
  let nullCount = 0;
  let zeroCount = 0;

  for (const pos of closedPositions) {
    if (pos.realizedPnl === null) {
      nullCount++;
    } else {
      const pnl = parseFloat(pos.realizedPnl);
      if (pnl === 0) zeroCount++;
      totalPnl += pnl;
    }
  }

  console.log('\n📈 SUMMARY:');
  console.log(`   Total positions: ${closedPositions.length}`);
  console.log(`   NULL realizedPnl: ${nullCount}`);
  console.log(`   Zero realizedPnl: ${zeroCount}`);
  console.log(`   Total P&L (sum of realizedPnl): $${totalPnl.toFixed(2)}`);
}

showExactQuery().catch(console.error);
