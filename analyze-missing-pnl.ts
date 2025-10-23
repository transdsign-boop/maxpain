import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';

async function analyzeMissingPnl() {
  console.log('🔍 ANALYZING MISSING P&L DATA\n');

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  const allPositions = await db.select().from(positions);

  // Categorize positions
  const open = allPositions.filter(p => p.isOpen);
  const closedWithPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);
  const closedNoPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl === null);

  console.log('📊 POSITION BREAKDOWN:\n');
  console.log(`Total Positions: ${allPositions.length}`);
  console.log(`  ├─ Open: ${open.length}`);
  console.log(`  ├─ Closed with P&L: ${closedWithPnl.length}`);
  console.log(`  └─ Closed WITHOUT P&L: ${closedNoPnl.length} ⚠️\n`);

  if (closedNoPnl.length > 0) {
    console.log('❌ PROBLEM IDENTIFIED:');
    console.log(`   ${closedNoPnl.length} closed positions have NULL realized P&L!\n`);

    // Sample some positions
    console.log('📋 Sample of positions with missing P&L:');
    for (let i = 0; i < Math.min(10, closedNoPnl.length); i++) {
      const pos = closedNoPnl[i];
      console.log(`   ${i+1}. ${pos.symbol} ${pos.side} - Size: ${pos.positionSize}, Entry: $${pos.avgEntryPrice}`);
      console.log(`      Closed at: ${pos.closedAt || 'unknown'}`);
    }

    console.log(`\n💡 EXPLANATION:`);
    console.log(`   These ${closedNoPnl.length} positions were closed but their P&L`);
    console.log(`   was never fetched from the exchange API.`);
    console.log(`   This explains the $123.61 discrepancy.\n`);

    console.log(`🔧 SOLUTION:`);
    console.log(`   Run the exchange sync script to fetch missing P&L data:`);
    console.log(`   - This will query the exchange API for historical trades`);
    console.log(`   - Match them to closed positions`);
    console.log(`   - Update the realizedPnl field\n`);
  } else {
    console.log('✅ All closed positions have P&L data recorded!\n');
  }

  // Check if there's a pattern
  const bySymbol = new Map<string, number>();
  for (const pos of closedNoPnl) {
    bySymbol.set(pos.symbol, (bySymbol.get(pos.symbol) || 0) + 1);
  }

  if (bySymbol.size > 0) {
    console.log('📈 MISSING P&L BY SYMBOL:');
    const sorted = Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]);
    for (const [symbol, count] of sorted.slice(0, 10)) {
      console.log(`   ${symbol}: ${count} positions`);
    }
  }
}

analyzeMissingPnl().catch(console.error);
