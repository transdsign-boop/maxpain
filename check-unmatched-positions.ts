import { db } from './server/db';
import { positions } from '@shared/schema';
import { inArray, isNull } from 'drizzle-orm';

async function checkUnmatchedPositions() {
  console.log('🔍 Checking unmatched positions (NULL realizedPnl)...\n');

  const activeSessions = [
    '2b4478ae-09f0-446e-90b9-a22b444156e4',
    '715c61d4-d238-4a51-98a3-0550f1865b90',
    'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6',
    '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'
  ];

  const allPositions = await db.select().from(positions)
    .where(inArray(positions.sessionId, activeSessions));

  const closedPositions = allPositions.filter(p => !p.isOpen && p.closedAt);
  const unmatchedPositions = closedPositions.filter(p => p.realizedPnl === null);

  console.log(`Total closed positions: ${closedPositions.length}`);
  console.log(`Unmatched (NULL realizedPnl): ${unmatchedPositions.length}\n`);

  // Group by symbol
  const bySymbol = new Map<string, number>();
  const bySession = new Map<string, number>();

  for (const pos of unmatchedPositions) {
    bySymbol.set(pos.symbol, (bySymbol.get(pos.symbol) || 0) + 1);
    bySession.set(pos.sessionId, (bySession.get(pos.sessionId) || 0) + 1);
  }

  console.log('📊 Unmatched by Symbol:');
  const sortedSymbols = Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]);
  sortedSymbols.forEach(([symbol, count]) => {
    console.log(`   ${symbol}: ${count}`);
  });

  console.log('\n📊 Unmatched by Session:');
  bySession.forEach((count, sessionId) => {
    const shortId = sessionId.slice(0, 8);
    console.log(`   ${shortId}...: ${count}`);
  });

  // Show sample of unmatched positions
  console.log('\n📋 Sample of unmatched positions (first 20):');
  unmatchedPositions.slice(0, 20).forEach((pos, i) => {
    const quantity = parseFloat(pos.totalQuantity || '0');
    const avgEntry = parseFloat(pos.avgEntryPrice || '0');
    const notional = quantity * avgEntry;

    console.log(`\n${i + 1}. ${pos.symbol} ${pos.side}`);
    console.log(`   Closed: ${pos.closedAt}`);
    console.log(`   Notional: $${notional.toFixed(2)}`);
    console.log(`   Quantity: ${quantity.toFixed(4)}, Entry: $${avgEntry.toFixed(4)}`);
    console.log(`   Layers filled: ${pos.layersFilled}`);
    console.log(`   Session: ${pos.sessionId.slice(0, 8)}...`);
  });

  // Check date range of unmatched
  const sortedByDate = [...unmatchedPositions].sort((a, b) =>
    new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
  );

  console.log('\n📅 Date Range of Unmatched:');
  console.log(`   Earliest: ${sortedByDate[0]?.closedAt}`);
  console.log(`   Latest: ${sortedByDate[sortedByDate.length - 1]?.closedAt}`);

  // Check if these might be zero P&L positions
  console.log('\n💭 Possible reasons for no match:');
  console.log('   1. Position closed with zero P&L (no exchange event generated)');
  console.log('   2. Position closed outside of exchange API date range');
  console.log('   3. Timestamp mismatch between database and exchange');
  console.log('   4. Position was never actually executed on exchange (paper trading artifacts?)');
}

checkUnmatchedPositions().catch(console.error);
