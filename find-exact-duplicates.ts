import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';

async function findExactDuplicates() {
  console.log('🔍 FINDING EXACT DUPLICATE POSITIONS\n');

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  const allPositions = await db.select().from(positions);
  const closedWithPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);

  // Group by symbol, side, realizedPnl, and closedAt
  const groupKey = (p: any) =>
    `${p.symbol}_${p.side}_${p.realizedPnl}_${new Date(p.closedAt).getTime()}`;

  const grouped = new Map<string, any[]>();

  for (const pos of closedWithPnl) {
    if (!pos.closedAt) continue;
    const key = groupKey(pos);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(pos);
  }

  // Find groups with more than 1 position
  const duplicates = Array.from(grouped.entries())
    .filter(([_, positions]) => positions.length > 1)
    .sort((a, b) => {
      const pnlA = Math.abs(parseFloat(a[1][0].realizedPnl));
      const pnlB = Math.abs(parseFloat(b[1][0].realizedPnl));
      return pnlB - pnlA; // Sort by P&L magnitude
    });

  console.log(`📊 DUPLICATE ANALYSIS:`);
  console.log(`   Total closed positions with P&L: ${closedWithPnl.length}`);
  console.log(`   Duplicate groups found: ${duplicates.length}\n`);

  if (duplicates.length === 0) {
    console.log('✅ No exact duplicates found!\n');
    return;
  }

  let totalDuplicatePnl = 0;
  let totalDuplicatePositions = 0;

  console.log('❌ EXACT DUPLICATES (same symbol, side, P&L, close time):\n');

  for (let i = 0; i < Math.min(20, duplicates.length); i++) {
    const [key, dups] = duplicates[i];
    const pnl = parseFloat(dups[0].realizedPnl);
    const extraCount = dups.length - 1; // Number of duplicate copies
    const duplicatePnl = pnl * extraCount;

    totalDuplicatePnl += duplicatePnl;
    totalDuplicatePositions += extraCount;

    console.log(`${i+1}. ${dups[0].symbol} ${dups[0].side}: $${pnl.toFixed(2)}`);
    console.log(`   Appears ${dups.length} times (${extraCount} duplicate${extraCount > 1 ? 's' : ''})`);
    console.log(`   Closed: ${dups[0].closedAt}`);
    console.log(`   Duplicate P&L impact: $${duplicatePnl.toFixed(2)}`);
    console.log(`   Position IDs:`);
    for (const dup of dups) {
      console.log(`      - ${dup.id} (session: ${dup.sessionId.substring(0, 8)}...)`);
    }
    console.log();
  }

  console.log('=' .repeat(60));
  console.log(`\n💥 IMPACT SUMMARY:`);
  console.log(`   Total duplicate positions: ${totalDuplicatePositions}`);
  console.log(`   Total inflated P&L: $${totalDuplicatePnl.toFixed(2)}\n`);

  // Calculate what the true P&L should be
  const currentDbPnl = closedWithPnl.reduce((sum, p) => sum + parseFloat(p.realizedPnl!), 0);
  const correctedPnl = currentDbPnl - totalDuplicatePnl;

  console.log(`   Current DB P&L: $${currentDbPnl.toFixed(2)}`);
  console.log(`   Corrected P&L (after removing duplicates): $${correctedPnl.toFixed(2)}`);
  console.log(`   Exchange API P&L: $819.93`);
  console.log(`   Remaining difference: $${(correctedPnl - 819.93).toFixed(2)}\n`);

  console.log('=' .repeat(60));
}

findExactDuplicates().catch(console.error);
